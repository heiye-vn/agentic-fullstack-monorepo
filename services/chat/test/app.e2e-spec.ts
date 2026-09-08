import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { APP_NAME } from '@autix/contracts';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ ok: true });
  });

  it('/hello (GET)', () => {
    return request(app.getHttpServer())
      .get('/hello')
      .expect(200)
      .expect({ message: `Hello from Chat, shared APP_NAME=${APP_NAME}` });
  });

  it('/api/langchain/prompt-preview (POST)', () => {
    return request(app.getHttpServer())
      .post('/api/langchain/prompt-preview')
      .send({ input: '用户注册时必须绑定手机号，密码至少8位' })
      .expect(201)
      .expect((res) => {
        expect(res.body.input).toBe('用户注册时必须绑定手机号，密码至少8位');
        expect(res.body.messages).toHaveLength(2);
        expect(res.body.messages[0].role).toBe('system');
        expect(res.body.messages[1].role).toBe('human');
        expect(res.body.messages[1].content).toContain(
          '用户注册时必须绑定手机号，密码至少8位',
        );
      });
  });

  afterEach(async () => {
    await app.close();
  });
});

