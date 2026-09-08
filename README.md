# Autix Monorepo

基于 **pnpm workspaces** + **Turborepo** 构建的企业级全栈多包架构（Monorepo）项目，集成了 **Next.js 16 (App Router)** 现代化前端工作台、**NestJS** 微服务集群、**Prisma + PostgreSQL** 数据持久层、**LangChain LCEL** 大模型调用链，以及 **TypeScript 共享类型契约** 和 **Docker Compose** 容器化编排。

---

## 🎯 项目背景与阶段规划

本项目用于 **AI Agent（人工智能体）全栈落地开发实践与技术探索**，采用分阶段渐进式演进路线：

- **Chapter 01: 全栈工程化底座**：搭建基于 pnpm + Turborepo 的多包工作区，实现类型契约跨端共享、独立 Dockerfile 打包与本地容器热更新。
- **Chapter 02: 企业级 RBAC 权限管控系统**：基于 PostgreSQL + Prisma 落地双 Token 轮转鉴权、细粒度权限守卫、用户与组织树管理、操作审计及 Next.js 16 Proxy 管理中台。
- **Chapter 03: 基于 LangChain 的需求分析提取平台**：构建基于 LangChain Expression Language (LCEL) 的提示词管道、流式 SSE 响应、Zod 结构化抽取、自动工具循环（Tool Loop），并提供 Linear 曜石黑风格的交互工作界面。

---

## 📂 项目全景目录

```text
.
├── clients/
│   ├── chat-web/             # [Next.js 16] 需求分析提取前端界面 (端口 3002)
│   └── admin-web/            # [Next.js 16 + HeroUI] RBAC 权限管理控制中心 (端口 3100)
├── services/
│   ├── chat/                 # [NestJS] LangChain 需求分析与调用链后端服务 (端口 4001)
│   └── user-system/          # [NestJS + Prisma] 认证鉴权与用户权限微服务 (端口 4002)
├── packages/
│   └── contracts/            # TypeScript 共享数据类型契约与 Zod Schema
├── docs/
│   └── apifox/               # Apifox 接口测试导出集合 (按章节归档)
├── infra/
│   └── compose/              # Dockerfile 镜像构建与 Docker Compose 容器编排
│       ├── Dockerfile.chat   # chat 服务构建镜像
│       ├── Dockerfile.web    # 前端独立运行时镜像
│       ├── compose.yaml      # 生产容器环境编排
│       └── compose.dev.yaml  # 开发热重载与 PostgreSQL 容器编排
├── pnpm-workspace.yaml       # pnpm monorepo 工作区配置
├── turbo.json                # Turborepo 任务编排与依赖拓扑流水线
├── tsconfig.base.json        # 基础 TypeScript 编译与路径别名配置
└── package.json              # 根工程脚本与统一包管理器配置
```

---

## 🛠️ 技术栈清单

- **Monorepo 管理**：`pnpm workspaces` + `Turborepo` 统一驱动任务拓扑构建与依赖硬链接
- **前端工程**：Next.js 16 (Turbopack, App Router)、React 19、Tailwind CSS、HeroUI、Lucide Icons
- **后端框架**：NestJS 12 (TypeScript, Express 适配器, Module / Controller / Service 分层)
- **AI 与大模型生态**：`@langchain/core`、`@langchain/openai`、`zod` (LCEL 管道、结构化输出、Tool Loop)
- **数据持久层**：PostgreSQL 16、Prisma ORM (Schema 迁移、种子填充、类型生成)
- **共享契约模式**：`@autix/contracts` 标准 CommonJS / TypeScript 输出，保证前后端零沟通成本契约对齐
- **容器化与运维**：Docker & Docker Compose、Alpine 极简镜像分阶段构建

---

## ⚡ 快速上手

### 1. 环境准备

- **Node.js**：`>= 22.0.0`
- **pnpm**：`>= 10.0.0`
- **Docker & Docker Compose**（可选，用于一键拉起 PostgreSQL 及容器化部署）

在根目录下安装全量工作区依赖：

```bash
pnpm install
```

### 2. 环境变量配置

请在对应服务目录下建立 `.env` 配置文件：

- **`services/chat/.env`**：
  ```env
  MODEL_NAME=gpt-4o-mini
  OPENAI_API_KEY=sk-your-key
  OPENAI_BASE_URL=https://api.openai.com/v1
  PORT=4001
  ```
- **`services/user-system/.env`**：
  ```env
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/autix_db?schema=public"
  JWT_SECRET="your-super-secret-jwt-key"
  JWT_REFRESH_SECRET="your-super-secret-refresh-key"
  PORT=4002
  ```

---

## 🚀 启动与构建指令

### 一键启动模式

```bash
# 并发启动工作区所有服务 (chat, user-system, chat-web, admin-web)
pnpm dev

# 一键并发启动 RBAC 权限管理系统 (user-system + admin-web)
pnpm dev:rbac
```

### 独立子系统启动

```bash
# 启动需求分析提取前端 (端口 3002)
pnpm dev:chat-web

# 启动 LangChain 需求分析后端服务 (端口 4001)
pnpm dev:chat

# 启动 RBAC 权限系统管理前端 (端口 3100)
pnpm dev:admin-web

# 启动 RBAC 用户与鉴权微服务 (端口 4002)
pnpm dev:user-system
```

### 全局编译构建与类型检查

```bash
# 依据 Turborepo 拓扑依赖全量构建各模块
pnpm run build

# 全工作区执行 TypeScript 静态类型检查
pnpm run typecheck
```

---

## 🤖 Chapter 03: 基于 LangChain 的需求分析提取平台

在第三阶段，项目全面引入 **LangChain v0.3+** 与 **LCEL（LangChain Expression Language）** 架构，实现了从基础模型调用到智能需求抽取、工具循环执行的工业级落地：

### 1. 功能点

- **LCEL 链式管道架构**：通过 `prompt.pipe(model).pipe(outputParser)` 编排声明式调用链，天然具备流式（Stream）、批处理（Batch）与单次调用（Invoke）一致性。
- **Zod 驱动的类型级结构化输出**：
  - 定义统一契约 [`packages/contracts`](./packages/contracts/src/index.ts) 中的 `RequirementSchema`：强制解析 `action`（核心动作）、`constraints`（约束列表）、`entities`（实体要素）。
  - 利用 `withStructuredOutput` 保证大模型 100% 遵守 JSON 契约结构，彻底摆脱传统正则匹配与脏 JSON 解析。
- **智能工具绑定与自动循环机制（Tool Loop）**：
  - 封装规范的 LangChain Tools（计算器、词频统计、格式清洗等）。
  - 实现基于 `AIMessage.tool_calls` 的自动调度循环（ReAct Loop），自动向模型回传 ToolMessage，直至输出最终需求分析结论。
- **Linear 曜石黑沉浸式工作台**：
  - 前端位于 [`clients/chat-web`](./clients/chat-web)，重构为左右双栏分屏工作台。
  - 左侧配置面板与多功能调用触发器；右侧提供支持 JSON 语法高亮、实时 SSE 文本流、卡片式结构化结果及 Tool 调试折叠面板的智能终端面板。
- **Apifox 接口规范资产**：
  - 在 [`docs/apifox/chapter03-first-chain.json`](./docs/apifox/chapter03-first-chain.json) 中内置全套 API 调试文件，开箱即用。

### 2. 界面效果展示

![Chapter 03 需求分析提取平台界面](./images/chapter03/01.png)

---

## 🔐 Chapter 02: RBAC 权限管控系统

在第二阶段，项目集成了企业级 RBAC（基于角色的访问控制）权限管理系统，涵盖前后端全链路安全鉴权闭环：

### 快速启动 RBAC 全套系统

```bash
# 1. 启动本地 PostgreSQL 容器
docker compose -f infra/compose/compose.dev.yaml up -d postgres

# 2. 同步数据库表结构并灌入初始种子数据 (组织、角色、权限树与预设账号)
pnpm --filter @autix/user-system prisma:push
pnpm --filter @autix/user-system prisma:seed

# 3. 一键并发启动 RBAC 前后端
pnpm dev:rbac
```

### 预设测试账号与角色

| 账号        | 密码        | 角色           | 权限范围                                                    |
| :---------- | :---------- | :------------- | :---------------------------------------------------------- |
| `admin`     | `Admin123!` | `super_admin`  | 全局完全支配权限（包含 `*:*:*` 旁路放行），防删除保护       |
| `test_ops`  | `Admin123!` | `admin`        | 系统运维主管，拥有除超级权限外的全量业务管理与配置权限      |
| `test_user` | `User123!`  | `general_user` | 普通员工，仅具备基础菜单与列表查询权限（写操作受 403 拦截） |

### 核心安全机制

- **双 Token 自动轮转**：短效 Access Token (15m) + 长效 Refresh Token (7d)，支持重放攻击拦截与即时吊销。
- **动态权限即时失效**：依托 `User.tokenVersion` 机制，管理员调整权限或禁用账号后毫秒级阻断已签发凭据。
- **Next.js 16 Proxy**：采用 Next.js 16 规范的 `proxy.ts` 流量代理边界进行前端路由拦截与安全控制。
- **全链路审计追踪**：集成 `LoginLog` 登录流水与 `OperationLog` 细粒度操作审计（包含入参敏感信息自动脱敏）。

---

## 🐳 Docker 容器化编排

项目所有容器配置文件集中存放在 [`infra/compose`](./infra/compose) 目录下。

### 生产容器编排启动

```bash
docker compose -f infra/compose/compose.yaml up --build
```

### 本地开发热更新模式

通过挂载宿主机源码卷到容器内，支持代码修改后实时重载：

```bash
docker compose -f infra/compose/compose.dev.yaml up
```
