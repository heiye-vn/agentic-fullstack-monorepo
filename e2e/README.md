# 浏览器级 E2E（第二十章 Layer 3）

这一层守的是**整条链路能不能通**：登录 → 发消息 → SSE 流式 → 落库 → 产物面板渲染。
Layer 1（vitest 单测）证明零件对，Layer 2（`fullchain:demo` 脚本）证明零件装得上，
这一层证明装好之后用户真的能用。

**默认不跑。** spec 里有 `test.skip(!RUN_BROWSER_E2E)`，必须显式 `RUN_BROWSER_E2E=1` 才执行。
因为它是真浏览器 + 真服务 + 真 LLM 调用：慢、花钱、依赖外部环境，属于 release gate，
不该进每次 PR（CI 里也是独立 job，靠 cron / 手动触发）。

## 前置：把整套服务跑起来

```bash
cd infra/compose
POSTGRES_PASSWORD=postgres OPENAI_API_KEY=... docker compose up --build
```

compose 暴露：

| 服务 | 地址 |
| --- | --- |
| chat-web | `http://localhost:3002` |
| chat API | `http://localhost:4001` |
| user-system API | `http://localhost:4002/api/v1` |

种子账号（user-system 的 `prisma/seed.ts`，argon2 哈希）：

- 账号：`admin`
- 密码：`Admin123!`

## 一次性安装 Playwright

`@playwright/test` **没有**写进根 `devDependencies`——一旦写进去而 lockfile 没同步，
CI 里所有 `pnpm install --frozen-lockfile` 的 job 会全挂。所以按需装：

```bash
pnpm add -D -w @playwright/test
pnpm exec playwright install chromium
```

## 运行

```bash
RUN_BROWSER_E2E=1 pnpm exec playwright test
```

可选覆盖：

```bash
RUN_BROWSER_E2E=1 \
E2E_WEB_URL=http://localhost:3002 \
E2E_CHAT_API_URL=http://localhost:4001 \
E2E_USERNAME=admin \
E2E_PASSWORD='Admin123!' \
E2E_SHOTS_DIR=docs/images/ch20 \
pnpm exec playwright test
```

## 覆盖内容

- 浏览器登录（走 user-system 拿 JWT，存进 `localStorage.accessToken`）
- 用同一个 JWT 调 chat API，验证鉴权链路打通
- 新建一个**空会话**再导航进去：避免默认会话里已有历史 artifact 导致面板「秒出」的假阳性
- ChatView 发消息打到 SSE controller，断言状态码 **200**（不是 NestJS POST 默认的 201）
- 等 `#artifact-panel` 出现且报告含知识库术语（证明 20.3 的 RAG 真的进了报告）
- 消息与产物落库校验（Postgres）
- 部署冒烟端点：`/ready`、`/metrics`、`/api/cost/summary`

## 已知坑

- **超时给得很宽是刻意的**：整测 12 分钟、等 artifact 9 分钟。真实 LLM 全图（含
  Critic-Refine 循环）在慢推理模型上一条短任务就要几分钟，超时收紧只会换来假失败。
- **截图会写进 `docs/images/ch20/`**，供第二十章文档引用；本地调试可改 `E2E_SHOTS_DIR`。
