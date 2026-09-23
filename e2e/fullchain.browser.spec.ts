import { expect, test } from '@playwright/test';

/**
 * 第二十章 Layer 3：浏览器级满血链路回归
 *
 * Layer 1（单测）证明每个零件对，Layer 2（脚本/demo）证明零件装得上，
 * 这一层证明**装好之后用户真的能用**：登录 → 发消息 → SSE 流式 → 落库 → 产物面板。
 *
 * 与 autix 同名用例的两处适配：
 *   1. **登录跳转目标不同**。autix 登录后落到 `/c/<id>`；本项目 login 页是
 *      `router.push('/')`，首页本身就是 ChatView，所以这里断言 `/`，
 *      再自己新建一个空会话导航进去做隔离。
 *   2. **种子账号不同**。user-system 的 seed 建的是 `admin / Admin123!`
 *      （prisma/seed.ts:392,395 用 argon2 哈希），不是 autix 的 Admin@123456。
 *
 * 测试自我隔离是刻意加的：直接用默认会话，侧边栏可能已经挂着历史 artifact，
 * 面板会「秒出」造成假阳性。新建空会话后断言的才是这一轮真跑出来的产物。
 */
const RUN_BROWSER_E2E = process.env.RUN_BROWSER_E2E === '1';
const CHAT_API_URL = process.env.E2E_CHAT_API_URL ?? 'http://localhost:4001';
const USERNAME = process.env.E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Admin123!';
const REPORT_TERMS = /企业微信|OAuth2|授权码|corpId|扫码登录|安全风险|验收标准/i;
// 关键步骤截图目录（可用 E2E_SHOTS_DIR 覆盖），供第二十章文档直接引用
const SHOTS_DIR = process.env.E2E_SHOTS_DIR ?? 'docs/images/ch20';

/**
 * chat 服务有全局响应拦截器（{success,code,msg,data}），
 * 而 user-system 没有（返回裸对象）—— 这里两边都可能取到，统一解一层。
 */
function unwrapData<T>(body: T | { data?: T }): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data?: T }).data as T;
  }
  return body as T;
}

test.describe('Chapter 20 full-chain browser E2E', () => {
  test.skip(
    !RUN_BROWSER_E2E,
    'Set RUN_BROWSER_E2E=1 after starting user-system, chat, and chat-web.',
  );

  test('login -> ChatView -> SSE -> Controller -> DB -> Artifact -> browser assert', async ({
    page,
    request,
  }) => {
    // 0. 前置：chat 就绪探针（/ready 探依赖，/health 只是 liveness 不探依赖）
    const ready = await request.get(`${CHAT_API_URL}/ready`);
    expect(ready.ok(), '/ready should be healthy before browser flow starts').toBeTruthy();

    const smokePrompt = [
      '为后台管理系统增加企业微信扫码登录。',
      '要求：使用 OAuth2 授权码模式，回调时校验 corpId，自动绑定已有账号。',
      '请输出需求分析报告，并特别说明安全风险与验收标准。',
    ].join('\n');

    // 1. 浏览器登录（走 user-system 签发 JWT）
    await page.goto('/login');
    await page.getByLabel('账号').fill(USERNAME);
    await page.getByLabel('密码').fill(PASSWORD);
    await page.screenshot({ path: `${SHOTS_DIR}/01-login.png` });
    await page.getByRole('button', { name: /开始对话/ }).click();

    // 本项目登录成功后 push('/')，首页即 ChatView
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Chat workspace')).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/02-workspace.png` });

    const token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token, 'login should store JWT accessToken').toBeTruthy();

    // 2. 新建空会话并导航进去，保证断言的是本轮产物
    const authHeaders = { Authorization: `Bearer ${token}` };
    const freshConv = await request.post(`${CHAT_API_URL}/api/conversations`, {
      headers: authHeaders,
      data: { title: `e2e-fullchain-${Date.now()}` },
    });
    expect(freshConv.ok(), 'should create a fresh conversation for the run').toBeTruthy();
    const freshId = unwrapData<{ id: string }>(await freshConv.json()).id;
    expect(freshId, 'fresh conversation should have an id').toBeTruthy();
    await page.goto(`/c/${freshId}`);
    await expect(page).toHaveURL(new RegExp(`/c/${freshId}$`));

    // 3. 发消息：断言真的打在 SSE controller 上
    await page.getByLabel('消息输入框').fill(smokePrompt);
    const chatResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/conversations/') &&
        response.url().endsWith('/chat'),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '发送消息' }).click();
    const chatResponse = await chatResponsePromise;

    // 用户气泡已渲染。用提示词独有开头 + .first() 避免 getByText 多处命中触发 strict mode
    await expect(
      page.getByText('为后台管理系统增加企业微信扫码登录').first(),
    ).toBeVisible();
    // 20.7：SSE 响应状态码是 200（不是 NestJS POST 默认的 201），
    // 否则浏览器的 EventSource/fetch 流在某些代理下会被缓冲住
    expect(chatResponse.status(), 'ChatView should post through the SSE controller').toBe(200);
    await page.screenshot({ path: `${SHOTS_DIR}/03-streaming.png` });

    const conversationId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
    expect(conversationId, 'browser URL should contain the active conversation id').toBeTruthy();

    // 4. 等产物面板：真实 LLM 全图（triage → 专家 → Critic-Refine → summary → upsertArtifact）
    //    再经 artifact_created SSE 事件加载面板。慢推理模型下一条短任务实测数分钟，
    //    给到 9 分钟余量（Layer 3 是 release gate，不进每次 PR，慢得起）。
    await expect(page.locator('#artifact-panel')).toBeVisible({ timeout: 540_000 });
    await expect(page.locator('#artifact-panel')).toContainText(REPORT_TERMS);
    await page.screenshot({ path: `${SHOTS_DIR}/04-artifact.png`, fullPage: true });

    // 5. 落库校验：消息与产物都写进了 Postgres
    const messages = await request.get(
      `${CHAT_API_URL}/api/conversations/${conversationId}/messages`,
      { headers: authHeaders },
    );
    expect(messages.ok(), 'messages endpoint should be readable with the same JWT').toBeTruthy();
    const messageRows = unwrapData<Array<{ role: string; content: string }>>(await messages.json());
    expect(
      messageRows.some((m) => m.role === 'USER' && m.content.includes('企业微信')),
      'user message should be persisted',
    ).toBeTruthy();
    expect(
      messageRows.some((m) => m.role === 'ASSISTANT' && m.content.length > 100),
      'assistant report should be persisted',
    ).toBeTruthy();

    const artifact = await request.get(
      `${CHAT_API_URL}/api/artifacts/conversation/${conversationId}`,
      { headers: authHeaders },
    );
    expect(artifact.ok(), 'artifact should be persisted for the conversation').toBeTruthy();
    const artifactBody = unwrapData<{ content?: string; currentVersion?: number } | null>(
      await artifact.json(),
    );
    expect(
      artifactBody?.content?.length ?? 0,
      'artifact content should be non-empty',
    ).toBeGreaterThan(100);
    expect(artifactBody?.content ?? '').toMatch(REPORT_TERMS);
    expect(
      artifactBody?.currentVersion,
      'artifact should have a persisted version',
    ).toBeGreaterThanOrEqual(1);

    // 6. 部署冒烟端点（第十九章 CI 里也打这两个）
    const cost = await request.get(`${CHAT_API_URL}/api/cost/summary`, {
      headers: authHeaders,
    });
    expect(cost.ok(), 'cost summary should be available after a full-chain request').toBeTruthy();

    const metrics = await request.get(`${CHAT_API_URL}/metrics`);
    expect(metrics.ok(), '/metrics should be exposed for deployment smoke checks').toBeTruthy();
    expect(await metrics.text()).toContain('# HELP');
  });
});
