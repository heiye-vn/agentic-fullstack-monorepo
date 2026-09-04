# Autix Monorepo

基于 **pnpm workspaces** + **Turborepo** 构建的全栈多包架构（Monorepo）项目，集成了 **Next.js (App Router)** 前端客户端、**NestJS** 后端微服务、**TypeScript 编译产物共享包** 以及完整的 **Docker Compose** 容器编排支持。

---

## 🎯 项目背景与定位

本项目用于 **AI Agent（人工智能体）开发实践与技术探索**。

目前阶段已完成工程化底座的搭建，构建了一套结构清晰、类型共享、支持容器化部署的全栈 Monorepo 基础架构；后续将在此底座之上，逐步扩展并落地 AI 对话、工具调用与 Agent 智能体等相关核心能力。

---

## 目录结构

```text
.
├── clients/
│   └── chat-web/             # Next.js (App Router) 前端应用 (端口 3002)
├── services/
│   └── chat/                 # NestJS 后端微服务 (端口 4001)
├── packages/
│   └── contracts/            # 共享契约与公用库 (采用 tsc 编译产物 dist 模式)
├── infra/
│   └── compose/              # 容器化编排与 Dockerfile 配置
│       ├── Dockerfile.chat   # NestJS 后端镜像构建定义
│       ├── Dockerfile.web    # Next.js 前端独立运行时镜像构建定义
│       ├── compose.yaml      # 生产环境 Compose 编排文件
│       └── compose.dev.yaml  # 开发热更新 Compose 编排文件
├── pnpm-workspace.yaml       # pnpm monorepo 工作区定义
├── turbo.json                # Turborepo 任务编排与依赖拓扑配置
├── tsconfig.base.json        # 基础 TypeScript 编译配置与 paths 映射
└── package.json              # 根项目配置与常用运行脚本
```

---

## 技术栈与设计亮点

- **包管理器**：`pnpm@10.12.1`（利用硬链接节省磁盘空间，严格规范 phantom dependencies）
- **构建流水线**：`Turborepo` 统一驱动 `build`、`dev`、`typecheck` 等跨包任务，利用拓扑图自动解析构建先后依赖
- **共享契约模式**：`@autix/contracts` 采用标准 CommonJS 编译产物模式（输出至 `dist/`，包含 `.d.ts` 与 Source Map），兼容 ESM 与 Node.js 模块生态
- **前端客户端**：Next.js App Router 架构，配置 `output: "standalone"` 与根目录依赖追踪（`outputFileTracingRoot`）
- **后端微服务**：NestJS，显式监听 `4001` 端口，集成 CORS 放行 `http://localhost:3002`，提供 `/health` 与 `/hello` 接口
- **容器化支持**：基于 `node:22-alpine` 与 `corepack`，具备生产独立镜像、健康检查依赖（`service_healthy`）与本地开发源码卷挂载热更新能力

---

## 环境要求

- **Node.js**：`>= 22.0.0`
- **pnpm**：`>= 10.0.0`（推荐 `10.12.1` 或最新版）
- **Docker & Docker Compose**（可选，用于容器化运行）

---

## 快速上手

### 1. 安装项目依赖

在项目根目录下执行：

```bash
pnpm install
```

pnpm 会自动解析 `clients/*`、`services/*`、`packages/*` 下的包并将 `@autix/contracts` 软链至各个应用。

### 2. 本地并发开发

在根目录执行以下命令，Turborepo 会自动并发启动前端与后端：

```bash
pnpm dev
```

- **Next.js Web 客户端**：访问 [http://localhost:3002](http://localhost:3002)
- **NestJS Chat 服务**：访问 [http://localhost:4001](http://localhost:4001)

### 3. 单独启动子项目

若仅需单独启动前端或后端，可直接运行：

```bash
# 仅启动 Next.js 前端 (端口 3002)
pnpm dev:chat-web

# 仅启动 NestJS 后端 (端口 4001)
pnpm dev:chat
```

### 4. 构建与类型检查

```bash
# 按照拓扑图执行全量构建 (contracts -> chat-web & chat)
pnpm run build

# 全局 TypeScript 静态类型检查
pnpm run typecheck
```

---

## 服务端口与接口规范

| 服务 / 模块 | 运行端口 | 路由端点 | 描述 |
| :--- | :--- | :--- | :--- |
| **chat-web** | `3002` | `/` | Web 前端界面，展示共享常量并提供调用按钮 |
| **chat** | `4001` | `GET /health` | 服务健康检查端点，返回 `{ "ok": true }` |
| **chat** | `4001` | `GET /hello` | 业务问候端点，返回 `{ "message": "Hello from Chat, shared APP_NAME=llm" }` |

---

## Docker 容器化编排

项目所有容器配置文件集中存放在 [infra/compose](file:///d:/ZSP/Study/Ai%20Agent/new_project/infra/compose) 目录下。

### 生产容器编排启动

包含后端 `/health` 健康检查，前端服务将在后端状态就绪（`service_healthy`）后自动唤醒：

```bash
docker compose -f infra/compose/compose.yaml up --build
```

### 本地开发热更新模式

通过挂载宿主机源码卷到容器内，支持代码修改后实时重载：

```bash
docker compose -f infra/compose/compose.dev.yaml up
```

---

## 🔐 Chapter 02: RBAC 权限管控系统

本项目在第二阶段集成了企业级 RBAC（基于角色的访问控制）权限管理系统，涵盖前后端全链路安全鉴权闭环。

### 模块架构
- **后端服务**：[`services/user-system`](file:///d:/ZSP/Study/Ai%20Agent/agentic-fullstack-monorepo/services/user-system)（NestJS + Prisma + PostgreSQL，端口 `4002`）
- **管理前端**：[`clients/admin-web`](file:///d:/ZSP/Study/Ai%20Agent/agentic-fullstack-monorepo/clients/admin-web)（Next.js 16 + HeroUI + Tailwind 4 + Proxy，端口 `3003`）

### 快速启动 RBAC 全套系统
```bash
# 1. 启动本地 PostgreSQL 容器
docker compose -f infra/compose/compose.dev.yaml up -d postgres

# 2. 数据库迁移与种子数据灌入 (自动创建组织、角色、权限树与初始账号)
pnpm --filter @autix/user-system prisma:seed

# 3. 一键并发启动 RBAC 前后端
pnpm dev:rbac
```

### 预设测试账号与角色
| 账号 | 密码 | 角色 | 权限范围 |
| :--- | :--- | :--- | :--- |
| `admin` | `Admin123!` | `super_admin` | 全局完全支配权限（包含 `*:*:*` 与旁路放行），防删除锁定 |
| `test_ops` | `Admin123!` | `admin` | 系统运维主管，拥有除超级权限外的全量业务管理与配置权限 |
| `test_user` | `User123!` | `general_user` | 普通员工，仅具备基础菜单与列表查询权限（写操作受 403 严格拦截） |

### 核心安全机制
- **双 Token 自动轮转**：短效 Access Token (15m) + 长效 Refresh Token (7d)，支持重放攻击拦截与即时吊销。
- **动态权限即时失效**：依托 `User.tokenVersion` 机制，管理员调整用户权限/角色后毫秒级阻断旧凭据。
- **Next.js 16 Proxy**：采用 Next.js 16 规范的 `proxy.ts` 流量代理边界进行前端路由拦截与安全控制。
- **全链路审计追踪**：集成 `LoginLog` 登录流水与 `OperationLog` 细粒度操作审计（含入参敏感信息脱敏）。

