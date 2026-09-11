import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('SearchController E2E Tests (POST /api/search)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const jwtSecret =
    process.env.JWT_SECRET || 'autix_rbac_jwt_secret_key_2026_super_secure';

  const userAlice = { sub: 'search_user_alice', username: 'alice' };
  let aliceToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = app.get(JwtService);
    aliceToken = jwtService.sign(userAlice, { secret: jwtSecret });
  });

  afterAll(async () => {
    await app.close();
  });

  it('未携带 Token 访问 POST /api/search 应返回 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .post('/api/search')
      .send({ query: '测试语义检索' })
      .expect(401);
  });

  it('携带 Token 但未提供有效 query 字段应返回 400 Bad Request', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/search')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ query: '   ' })
      .expect(400);

    expect(res.body.message).toContain('query 检索词不能为空');
  });

  it('携带合法 Token 和 query 应返回 200 OK 及规范的检索结果结构', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/search')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ query: '角色访问控制 RBAC', topK: 3 })
      .expect(200);

    expect(res.body).toHaveProperty('query', '角色访问控制 RBAC');
    expect(res.body).toHaveProperty('topK', 3);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });
});
