import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

describe('Auth Module Integration Test', () => {
  let prisma: PrismaService;
  let authService: AuthService;
  let jwtService: JwtService;

  const testUser = {
    username: `authtest_${Date.now()}`,
    password: 'Password123!',
    realName: '认证测试用户',
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    jwtService = new JwtService({
      secret: process.env.JWT_SECRET || 'autix_rbac_jwt_secret_key_2026_super_secure',
      signOptions: { expiresIn: '15m' },
    });
    authService = new AuthService(prisma, jwtService);
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.loginLog.deleteMany({ where: { username: testUser.username } });
    await prisma.refreshToken.deleteMany({ where: { user: { username: testUser.username } } });
    await prisma.user.deleteMany({ where: { username: testUser.username } });
    await prisma.$disconnect();
  });

  it('1. should register a new user with hashed password', async () => {
    const user = await authService.register(testUser);
    expect(user.id).toBeDefined();
    expect(user.username).toBe(testUser.username);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.passwordHash).not.toBe(testUser.password);
  });

  it('2. should reject login with incorrect password and log failure', async () => {
    await expect(
      authService.login({
        username: testUser.username,
        password: 'WrongPassword!',
      }),
    ).rejects.toThrow(UnauthorizedException);

    const log = await prisma.loginLog.findFirst({
      where: { username: testUser.username, status: 'FAIL' },
      orderBy: { loginAt: 'desc' },
    });
    expect(log).toBeDefined();
    expect(log?.message).toContain('密码错误');
  });

  let savedTokens: { accessToken: string; refreshToken: string };

  it('3. should successfully login with valid credentials, store hashed token, and log success', async () => {
    const result = await authService.login({
      username: testUser.username,
      password: testUser.password,
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user.username).toBe(testUser.username);

    savedTokens = result;

    // 验证数据库中存的是 Hash 后的 token
    const tokenHash = authService.hashToken(result.refreshToken);
    const dbRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    expect(dbRecord).toBeDefined();
    expect(dbRecord?.revokedAt).toBeNull();

    // 验证成功登录日志
    const successLog = await prisma.loginLog.findFirst({
      where: { username: testUser.username, status: 'SUCCESS' },
      orderBy: { loginAt: 'desc' },
    });
    expect(successLog).toBeDefined();
  });

  let newTokens: { accessToken: string; refreshToken: string };

  it('4. should refresh token, rotate tokens, and revoke the old token', async () => {
    newTokens = await authService.refreshToken({
      refreshToken: savedTokens.refreshToken,
    });

    expect(newTokens.accessToken).toBeDefined();
    expect(newTokens.refreshToken).toBeDefined();
    expect(newTokens.refreshToken).not.toBe(savedTokens.refreshToken);

    // 检查旧 token 是否已被打上 revokedAt 标记
    const oldHash = authService.hashToken(savedTokens.refreshToken);
    const oldRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: oldHash },
    });
    expect(oldRecord?.revokedAt).not.toBeNull();
  });

  it('5. should reject previously revoked refresh token (replay attack prevention)', async () => {
    await expect(
      authService.refreshToken({
        refreshToken: savedTokens.refreshToken,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('6. should logout and revoke refresh tokens', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: testUser.username },
    });

    await authService.logout(user.id, newTokens.refreshToken);

    const newHash = authService.hashToken(newTokens.refreshToken);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash: newHash },
    });
    expect(record?.revokedAt).not.toBeNull();
  });
});
