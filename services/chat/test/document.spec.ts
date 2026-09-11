import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('DocumentController & DocumentService E2E Integration Test', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;

  const jwtSecret =
    process.env.JWT_SECRET || 'autix_rbac_jwt_secret_key_2026_super_secure';

  const user1 = { sub: 'doc_user_alice', username: 'alice' };
  const user2 = { sub: 'doc_user_bob', username: 'bob' };

  let user1Token: string;
  let user2Token: string;
  let uploadedDocId: string;
  let savedFilePath: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = app.get(JwtService);
    prisma = app.get(PrismaService);

    user1Token = jwtService.sign(user1, { secret: jwtSecret });
    user2Token = jwtService.sign(user2, { secret: jwtSecret });
  });

  afterAll(async () => {
    // 清理可能残留的测试数据
    if (uploadedDocId) {
      await prisma.document.deleteMany({
        where: { id: uploadedDocId },
      });
    }
    await prisma.document.deleteMany({
      where: { userId: { in: [user1.sub, user2.sub] } },
    });

    // 清理测试上传物理目录
    const aliceDir = path.resolve(process.cwd(), 'uploads', user1.sub);
    if (fs.existsSync(aliceDir)) {
      await fs.promises.rm(aliceDir, { recursive: true, force: true });
    }

    await app.close();
  });

  it('未携带 Token 访问 /api/documents 应返回 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/api/documents')
      .expect(401);
  });

  it('POST /api/documents/upload: 上传合法 text/markdown 文档应该成功并创建物理文件', async () => {
    const fileContent = '# 需求规格说明书\n\n本章节介绍基于角色的访问控制模型。\n\n## 权限架构\n包含超级管理员、项目管理员和普通开发者三类角色。';
    const testBuffer = Buffer.from(fileContent, 'utf-8');

    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('file', testBuffer, 'spec-requirement.md')
      .field('filename', '自定义需求说明书')
      .expect(201);

    expect(res.body.id).toBeDefined();
    uploadedDocId = res.body.id;
    savedFilePath = res.body.filePath;

    expect(res.body.filename).toBe('自定义需求说明书');
    expect(res.body.userId).toBe(user1.sub);
    expect(res.body.status).toBe('pending');
    expect(res.body.chunkCount).toBe(0);
    expect(res.body.size).toBe(testBuffer.length);

    // 验证保存路径格式：uploads/{userId}/{timestamp}-{name}
    expect(savedFilePath).toMatch(new RegExp(`^uploads/${user1.sub}/\\d+-spec-requirement\\.md$`));

    // 验证物理文件确实落盘且内容一致
    const fullPath = path.resolve(process.cwd(), savedFilePath);
    expect(fs.existsSync(fullPath)).toBe(true);
    const readOnDisk = await fs.promises.readFile(fullPath, 'utf-8');
    expect(readOnDisk).toBe(fileContent);
  });

  it('POST /api/documents/upload: 上传不支持的文件格式 (如 .exe) 应该返回 400 Bad Request', async () => {
    const fakeExeBuffer = Buffer.from('MZ_FAKE_EXECUTABLE_HEADER', 'utf-8');

    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('file', fakeExeBuffer, {
        filename: 'malicious.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);

    expect(res.body.message).toContain('不支持的文件类型');
  });

  it('GET /api/documents: Alice 应该能查询到自己的文档列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/documents')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((d: { id: string }) => d.id === uploadedDocId)).toBe(true);
  });

  it('GET /api/documents/:id: Alice 应该能获取自己文档的详细信息', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/documents/${uploadedDocId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.id).toBe(uploadedDocId);
    expect(res.body.filename).toBe('自定义需求说明书');
  });

  it('GET /api/documents/:id: Bob (User 2) 访问 Alice 的文档应返回 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .get(`/api/documents/${uploadedDocId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);
  });

  it('POST /api/documents/:id/process: Bob (User 2) 越权触发处理应返回 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .post(`/api/documents/${uploadedDocId}/process`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);
  });

  it('POST /api/documents/:id/process: Alice 触发处理应立即返回 202 Accepted，且后台完成切片与向量化', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/documents/${uploadedDocId}/process`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(202);

    expect(res.body.statusCode).toBe(202);
    expect(res.body.documentId).toBe(uploadedDocId);

    // 轮询等待后台异步流水线完成（通常耗时 500ms ~ 2000ms）
    let retries = 20;
    let completed = false;
    while (retries > 0) {
      await new Promise((r) => setTimeout(r, 300));
      const doc = await prisma.document.findUnique({
        where: { id: uploadedDocId },
      });
      if (doc && doc.status === 'done') {
        completed = true;
        expect(doc.chunkCount).toBeGreaterThan(0);
        break;
      }
      retries--;
    }

    expect(completed).toBe(true);

    // 验证 DocumentChunk 表中成功生成切片数据
    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: uploadedDocId },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('需求规格说明书');
  });

  it('DELETE /api/documents/:id: Bob 尝试删除 Alice 的文档应返回 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .delete(`/api/documents/${uploadedDocId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);
  });

  it('DELETE /api/documents/:id: Alice 删除文档成功，并级联清理物理文件和切片数据', async () => {
    const fullPath = path.resolve(process.cwd(), savedFilePath);
    expect(fs.existsSync(fullPath)).toBe(true);

    const res = await request(app.getHttpServer())
      .delete(`/api/documents/${uploadedDocId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.success).toBe(true);

    // 1. 物理文件应该被成功删除
    expect(fs.existsSync(fullPath)).toBe(false);

    // 2. 数据库中 Document 记录已被清除
    const docCheck = await prisma.document.findUnique({
      where: { id: uploadedDocId },
    });
    expect(docCheck).toBeNull();

    // 3. DocumentChunk 级联删除生效
    const chunksCheck = await prisma.documentChunk.findMany({
      where: { documentId: uploadedDocId },
    });
    expect(chunksCheck.length).toBe(0);

    uploadedDocId = '';
  });
});
