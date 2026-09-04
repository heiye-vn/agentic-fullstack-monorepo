import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { AuditStatus, CommonStatus } from '@prisma/client';

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
   * 用户注册 (方便初始化与创建测试账号)
   */
  async register(dto: RegisterDto) {
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
   * 内部方法：生成双 Token 并存储 Refresh Token 哈希
   */
  private async generateTokens(user: any, deviceId?: string) {
    const payload = {
      sub: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET || 'autix_rbac_jwt_secret_key_2026_super_secure',
      expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any,
    });

    // 生成安全随机的 Refresh Token
    const rawRefreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    // 默认 7 天有效期
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 落库存储
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        deviceId,
        expiresAt,
      },
    });

    // 聚合角色与权限码清单
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

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900, // 15 分钟
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        avatar: user.avatar,
        departmentId: user.departmentId,
        roles,
        permissions: Array.from(permissionsSet),
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
