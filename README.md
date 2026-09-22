# Autix Monorepo

基于 **pnpm workspaces** + **Turborepo** 构建的企业级全栈多包架构（Monorepo）智能体系统。集成了 **Next.js 16 (App Router)** 现代化工作台、**NestJS** 微服务集群、**LangGraph** 状态图编排、**Token 成本治理**、**Prisma + PostgreSQL** 向量数据持久层，以及 **TypeScript 跨端共享类型契约** 与 **Docker Compose** 容器化编排。

---

## 🌟 核心业务架构与特性

- **LangGraph 状态图与质量闭环**：
  - 基于 `@langchain/langgraph` 的 StateGraph 状态机设计，实现专家子图（Subgraph）编排、条件动态边（Conditional Edges）路由与 Critic-Refine 多轮反思修正质量闭环。
- **Token 经济学与成本治理（Chapter 10）**：
  - **模型分级路由（AgentModelSet）**：核心调度与风控专家绑定旗舰强模型，次要专家分配高性价比模型，降低 50%+ 调用成本。
  - **上下文膨胀抑制**：滑动窗口消息裁剪（Message Trimmer）+ 长对话自动摘要压缩（Conversation Compressor）。
  - **运行时预算策略与熔断**：支持月度预算阶梯管控，80% 触发低风险专家自动降级，超 100% 触发调用熔断。
  - **节点级 Usage 采集与前端可视化**：侧路自动提取持久化模型真实使用量，前端状态栏集成实时 Token 消耗、费用估算（USD/RMB）与降级状态徽标（`TokenCostBadge`）。
- **Generative UI 与确定性状态机**：
  - 基于 Zod 判别联合定义 8 类原子 UI 组件协议，结合确定性交互状态机（`UIFlowService`），使 AI 回复直接渲染为可操作组件并驱动业务闭环。
- **Claude 级 Artifacts 成果物全生命周期管理**：
  - 成果物多版本落库（`Artifact` / `ArtifactVersion`），支持右侧侧栏 Markdown 渲染、流程图渲染与基于用户指令的增量局部演进优化。
- **企业级全链路安全防护**：
  - **模型凭据落库加密**：采用 `AES-256-GCM` 算法对私有 API Key 进行落库加密，管理接口自动脱敏过滤。
  - **RBAC 权限安全体系**：双 Token 轮转鉴权、毫秒级动态权限吊销（`tokenVersion`）与全链路操作审计。

---

## 📂 项目全景目录

```text
.
├── clients/
│   ├── chat-web/             # [Next.js 16] 智能工作台与成果物交互界面 (端口 3002)
│   └── admin-web/            # [Next.js 16 + HeroUI] RBAC 权限管理控制中心 (端口 3100)
├── services/
│   ├── chat/                 # [NestJS + LangGraph] 智能体图推理、成本治理与 Artifact 服务 (端口 4005)
│   └── user-system/          # [NestJS + Prisma] 认证鉴权与用户权限微服务 (端口 4002)
├── packages/
│   └── contracts/            # TypeScript 共享数据契约与 Zod Schema 验证库
├── docs/
│   └── apifox/               # Apifox 接口测试导出集合 (按章节归档)
├── infra/
│   └── compose/              # Dockerfile 镜像构建与 Docker Compose 容器编排
│       ├── Dockerfile.chat   # chat 服务构建镜像
│       ├── Dockerfile.web    # 前端独立运行时镜像
│       ├── compose.yaml      # 生产容器环境编排
│       └── compose.dev.yaml  # 开发热重载与 PostgreSQL 容器编排
├── pnpm-workspace.yaml       # pnpm monorepo 工作区拓扑配置
├── turbo.json                # Turborepo 任务编排与构建流水线
├── tsconfig.base.json        # 全局 TypeScript 基础编译与路径映射配置
└── package.json              # 根工程依赖与统一启动脚本
```

---

## 🛠️ 技术栈清单

- **工作区拓扑**：`pnpm workspaces` + `Turborepo` 任务流水线构建与依赖硬链接
- **前端工程**：Next.js 16 (App Router, Turbopack)、React 19、Tailwind CSS、HeroUI、Lucide Icons
- **后端工程**：NestJS 12 (TypeScript, 模块化分层架构, Express 适配器)
- **智能体编排**：`@langchain/langgraph`、`@langchain/core`、`@langchain/openai`、`zod`
- **数据持久层**：PostgreSQL 16、Prisma ORM (多 Schema 隔离、数据迁移、自动生成 Client)
- **安全与加密**：Node.js Crypto (`AES-256-GCM` 凭据加密)、JWT 双 Token 轮转与守卫
- **容器与环境**：Docker Compose 多阶段构建（Debian slim 基础镜像）
- **交付流水线**：GitHub Actions（typecheck/lint/test/build 门禁 + nightly LLM 评测 + GHCR 镜像推送）

---

## ⚡ 快速上手

### 1. 环境准备

- **Node.js**：`>= 22.0.0`
- **pnpm**：`>= 10.0.0`
- **Docker**（用于本地启动 PostgreSQL 数据库）

```bash
# 全工作区安装依赖
pnpm install
```

### 2. 启动数据库底座

```bash
# 1. 启动本地 PostgreSQL 容器
docker compose -f infra/compose/compose.dev.yaml up -d postgres

# 2. 同步并初始化数据库表结构
pnpm --filter @autix/chat db:push          # 同步 chat 服务表结构
pnpm --filter @autix/user-system prisma:push # 同步 RBAC 权限系统表结构
pnpm --filter @autix/user-system prisma:seed # 灌入预设权限与账号
```

### 3. 环境变量配置

请在对应子目录下创建 `.env` 或 `.env.local` 配置文件（可直接参考各目录下的 `.env.example`）：

- **`services/chat/.env`**：
  ```env
  PORT=4005
  OPENAI_API_KEY=sk-your-model-key
  OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  DATABASE_URL="postgresql://postgres:postgres123@localhost:5432/autix_chat?schema=public"
  JWT_SECRET="autix_rbac_jwt_secret_key_2026_super_secure"
  MODEL_CONFIG_SECRET="your-32byte-secret-key-for-model-config"
  ```
- **`services/user-system/.env`**：
  ```env
  PORT=4002
  DATABASE_URL="postgresql://postgres:postgres123@localhost:5432/autix_db?schema=public"
  JWT_SECRET="autix_rbac_jwt_secret_key_2026_super_secure"
  JWT_REFRESH_SECRET="autix_rbac_jwt_refresh_secret_key_2026_super_secure"
  ```
- **`clients/chat-web/.env.local`**：
  ```env
  PORT=3002
  NEXT_PUBLIC_CHAT_API_URL=http://localhost:4005
  NEXT_PUBLIC_USER_API_URL=http://localhost:4002/api/v1
  ```
- **`clients/admin-web/.env.local`**：
  ```env
  PORT=3100
  NEXT_PUBLIC_USER_API_URL=http://localhost:4002/api/v1
  ```

---

## 🚀 统一脚本与启动指令

### 服务启动

```bash
# 并发启动所有前后端微服务 (chat, user-system, chat-web, admin-web)
pnpm dev

# 仅启动智能体对话全栈系统 (chat-web + chat)
pnpm dev:chat-web   # 前端工作台: http://localhost:3002
pnpm dev:chat       # 智能体后端: http://localhost:4005

# 仅启动企业级 RBAC 权限管理全栈系统 (admin-web + user-system)
pnpm dev:rbac       # 权限管理端: http://localhost:3100 (默认账号: admin / Admin123!)
```

### 验证与测试套件

| 验证目标 | 指令 | 说明 |
| :--- | :--- | :--- |
| **全库编译构建** | `pnpm run build` | Turborepo 拓扑并发构建全量应用 |
| **全库类型检查** | `pnpm run typecheck` | TypeScript 静态类型编译无错误校验 |
| **Token 成本治理测试** | `pnpm --filter @autix/chat test test/chapter10-token-economics.spec.ts` | 验证分级路由、滑动裁剪与预算熔断策略 |
| **状态图推理闭环测试** | `pnpm --filter @autix/chat test:graph` | 执行 LangGraph 端到端状态机测试 |
| **质检反思与专家测试** | `pnpm --filter @autix/chat test:critic` | 验证 Critic-Refine 自循环纠错 |
| **生成架构流程图** | `pnpm --filter @autix/chat graph:mermaid` | 导出 StateGraph 编译后的 Mermaid 架构图 |
| **数据库可视化面板** | `pnpm --filter @autix/chat db:studio` | 打开 Prisma Studio 管理持久化数据 |

---

## 🗺️ 演进路线与分支映射 (Roadmap)

本项目采用分阶段渐进式落地演进路线，各技术里程碑的源码已归档至对应 Git 分支。可通过 `git checkout <branch>` 检出对应阶段的完整实现：

| 阶段里程碑 | 对应 Git 分支 | 核心涵盖知识与技术要点 |
| :--- | :--- | :--- |
| **Chapter 01: 全栈工程化底座** | `chapter-01-monorepo-setup` | pnpm Workspaces + Turborepo 多包单体架构、类型共享与 Docker 热更底座 |
| **Chapter 02: 企业级 RBAC 权限管控** | `chapter-02-user-system` | PostgreSQL + Prisma 建模、双 Token 轮转鉴权、操作审计与 Next.js 16 代理中台 |
| **Chapter 03: 需求分析提取平台** | `chapter-03-first-chain` | LangChain LCEL 声明式调用链、Zod 结构化抽取契约与 Tool 循环调用 |
| **Chapter 04: 记忆与多 Agent 编排** | `chapter-04-agent-memory-tools` | Runnable 记忆上下文维护、沙箱文件工具链与主子 Agent 协同编排 |
| **Chapter 05: 数据库与 RAG 向量检索** | `chapter-05-db-vector` | 向量化存储与相似度检索、文档切块嵌入、持久化会话与 SSE 异步长任务 |
| **Chapter 06: AI UI 响应协议与工作台** | `chapter-06-ai-ui` | 8 大原子 UI 协议契约、UIFlowService 确定性交互状态机与三栏工作台 |
| **Chapter 08: LangGraph 状态图与闭环** | `chapter-08-langgraph` | StateGraph 状态机、条件动态路由、Critic 反思闭环、Artifacts 版本演进与密钥加密 |
| **Chapter 10: Token 经济学与成本治理** | `chapter-10-token` | 模型分级路由、滑动裁剪与长对话摘要压缩、节点 Usage 采集与预算熔断告警 |

---

## 🐳 Docker 容器编排

项目所有容器构建文件存放在 [`infra/compose`](./infra/compose) 目录。

### 一键拉起完整环境

```bash
cp infra/compose/.env.example infra/compose/.env   # 首次必须做，缺 .env 会直接报错
docker compose -f infra/compose/compose.yaml up -d --build
docker compose -f infra/compose/compose.yaml ps    # 观察 healthcheck 状态
```

`compose.yaml` 里的服务按 healthcheck 依次就绪：

```
postgres 健康 → migrate 跑完 prisma migrate deploy 后退出 → chat 就绪（/ready 返回 200）→ chat-web 启动
```

- `migrate` 是一次性 init 容器，跑 `migrate deploy`（只前滚、绝不重置），不是 `migrate dev`
- `chat` 的探针打的是 `/ready`（真探数据库）而不是 `/health`（liveness，刻意不探依赖）
- postgres 刻意不映射宿主机端口 —— 本机 5432 通常已被开发库占用，容器间走内部网络即可

> **第一步不能省**：`compose.yaml` 用 `${POSTGRES_PASSWORD:?...}` 声明必填变量，
> 缺少 `.env` 时会在启动时直接报错，而不是带着空密码把服务拉起来之后、
> 在 chat 连数据库时才失败 —— 后者的排查成本要高得多。

> **为什么基础镜像是 Debian slim 而不是 Alpine？**
> chat 的本地 embedding 走 `@xenova/transformers`，它依赖 `onnxruntime-node` 的原生库，
> 而该库只提供 glibc 版本 —— 在 musl 的 Alpine 里会以 `ld-linux-x86-64.so.2` 缺失直接崩溃。
> 这类问题 build 期完全看不出来，只有把容器真正跑起来才会暴露。

### 本地热开发容器编排

```bash
docker compose -f infra/compose/compose.dev.yaml up
```

该编排会把源码挂进容器并跑 watch，同时把 PostgreSQL 映射到宿主机 `5432` 便于本地工具连接。日常开发更推荐直接在宿主机跑 `pnpm dev`，容器编排主要用于调试容器内的行为。
