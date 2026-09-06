import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { AuditStatus, CommonStatus } from '@prisma/client';
import { getJwtSecret, parseExpiresInSeconds } from '../../common/jwt-secret.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * 密码哈希
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  /**
   * 验证密码
   */
  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * 计算 Token SHA-256 哈希
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * 用户注册 (仅在内网初始化 / 显式开启公开注册时可用)
   *
   * 安全约束：ENABLE_PUBLIC_REGISTRATION 未显式设置为 "true" 时接口关闭，
   * 防止生产环境暴露自助开户后门。
   */
  async register(dto: RegisterDto) {
    if (process.env.ENABLE_PUBLIC_REGISTRATION !== 'true') {
      throw new ForbiddenException('当前系统未开放自助注册，请联系管理员创建账号');
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        realName: dto.realName,
        email: dto.email,
        status: CommonStatus.ACTIVE,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * 用户登录逻辑 (双 Token + Refresh Token 哈希落库 + 登录日志)
   */
  async login(dto: LoginDto, ip = '127.0.0.1', userAgent = 'Unknown') {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      await this.recordLoginLog(dto.username, ip, userAgent, AuditStatus.FAIL, '账号不存在');
      throw new UnauthorizedException('账号或密码错误');
    }

    if (user.status !== CommonStatus.ACTIVE) {
      await this.recordLoginLog(dto.username, ip, userAgent, AuditStatus.FAIL, '账号已被冻结');
      throw new UnauthorizedException('该账号已被禁用，请联系管理员');
    }

    const isMatch = await this.verifyPassword(user.passwordHash, dto.password);
    if (!isMatch) {
      await this.recordLoginLog(dto.username, ip, userAgent, AuditStatus.FAIL, '密码错误');
      throw new UnauthorizedException('账号或密码错误');
    }

    // 登录成功，记录审计日志与更新最后登录时间
    await this.recordLoginLog(dto.username, ip, userAgent, AuditStatus.SUCCESS, '登录成功');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 签发 Token 并落库
    return this.generateTokens(user, dto.deviceId);
  }

  /**
   * 刷新 Token (Token Rotation)
   */
  async refreshToken(dto: RefreshTokenDto) {
    const hashed = this.hashToken(dto.refreshToken);

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashed },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Refresh Token 无效');
    }

    if (tokenRecord.revokedAt) {
      // 若已吊销的 token 再次被尝试使用，可能遭受重放攻击，强制吊销该用户所有活跃 token
      await this.prisma.refreshToken.updateMany({
        where: { userId: tokenRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('检测到凭证异常复用，请重新登录');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh Token 已过期，请重新登录');
    }

    const { user } = tokenRecord;
    if (user.status !== CommonStatus.ACTIVE || user.deletedAt) {
      throw new UnauthorizedException('账号已被禁用或删除');
    }

    // 吊销当前旧 Refresh Token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    // 签发新的一对 Token
    return this.generateTokens(user, tokenRecord.deviceId ?? undefined);
  }

  /**
   * 主动退出登录 / 精确注销会话
   */
  async logout(userId: string, rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const hash = this.hashToken(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      // 若未携带明确 refreshToken，吊销该用户所有活跃会话
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return { message: '退出成功' };
  }

  /**
   * 获取当前登录用户完整资料 (供 GET /auth/me)
   *
   * 注意：不能直接透传 JwtStrategy.validate 的返回值 —— 其键为 userId 且缺少
   * email/phone/avatar/department 等字段，前端以该对象覆盖本地 user 后会丢 id。
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        department: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在或已被注销');
    }

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      status: user.status,
      departmentId: user.departmentId,
      department: user.department,
      tokenVersion: user.tokenVersion,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.userRoles.map((ur) => ur.role),
      userRoles: user.userRoles.map((ur) => ({ role: ur.role })),
    };
  }

  /**
   * 自助更新个人资料 (仅允许修改联络信息，不触碰部门/状态/角色)
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在或已被注销');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        realName: dto.realName ?? undefined,
        email: dto.email ?? undefined,
        phone: dto.phone ?? undefined,
        avatar: dto.avatar ?? undefined,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        phone: true,
        avatar: true,
        departmentId: true,
      },
    });
  }

  /**
   * 自助修改登录密码
   *
   * 安全流程：校验旧密码 → Argon2 哈希落库 → 递增 tokenVersion
   * 使当前所有 Access Token 立即失效 → 吊销全部 Refresh Token 强制重新登录。
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在或已被注销');
    }

    const isOldMatch = await this.verifyPassword(user.passwordHash, dto.oldPassword);
    if (!isOldMatch) {
      throw new BadRequestException('原密码校验失败，请确认后重试');
    }

    const sameAsOld = await this.verifyPassword(user.passwordHash, dto.newPassword);
    if (sameAsOld) {
      throw new BadRequestException('新密码不能与原密码相同');
    }

    const passwordHash = await argon2.hash(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      }),
      // 密码变更后吊销该用户所有活跃会话凭证
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: '密码修改成功，请使用新密码重新登录' };
  }

  /**
   * 内部方法：生成双 Token 并存储 Refresh Token 哈希
   *
   * 性能设计：roles / permissions 直接写入 JWT payload，
   * 后续请求 JwtStrategy 无需再做多表 join 重算权限；
   * 权限变更场景由 tokenVersion 递增机制保证旧 Token 懒失效。
   */
  private async generateTokens(user: any, deviceId?: string) {
    // 聚合角色与权限码清单（签发时刻的快照，随 Token 生命周期生效）
    const roles: string[] = [];
    const permissionsSet = new Set<string>();

    if (user.userRoles) {
      for (const ur of user.userRoles) {
        if (ur.role.status === CommonStatus.ACTIVE && !ur.role.deletedAt) {
          roles.push(ur.role.code);
          if (ur.role.rolePermissions) {
            for (const rp of ur.role.rolePermissions) {
              if (rp.permission.status === CommonStatus.ACTIVE) {
                permissionsSet.add(rp.permission.code);
              }
            }
          }
        }
      }
    }
    const permissions = Array.from(permissionsSet);

    const payload = {
      sub: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
      roles,
      permissions,
    };

    const accessTokenTtl = parseExpiresInSeconds(process.env.JWT_EXPIRES_IN, 900);

    const accessToken = this.jwtService.sign(payload, {
      secret: getJwtSecret(),
      expiresIn: accessTokenTtl,
    });

    // 生成安全随机的 Refresh Token
    const rawRefreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    // Refresh Token 有效期（默认 7 天，可通过 REFRESH_TOKEN_EXPIRES_IN 配置）
    const refreshTtl = parseExpiresInSeconds(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 86400);
    const expiresAt = new Date(Date.now() + refreshTtl * 1000);

    // 落库存储
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        deviceId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: accessTokenTtl,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        departmentId: user.departmentId,
        roles,
        permissions,
      },
    };
  }

  /**
   * 记录登录审计日志
   */
  private async recordLoginLog(
    username: string,
    ip: string,
    userAgent: string,
    status: AuditStatus,
    message: string,
  ) {
    try {
      await this.prisma.loginLog.create({
        data: {
          username,
          ip,
          userAgent,
          status,
          message,
        },
      });
    } catch (err) {
      this.logger.error('Failed to write login log:', err);
    }
  }
}
