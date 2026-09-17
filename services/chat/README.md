# @autix/chat 微服务

基于 **NestJS 12**、**LangGraph (`@langchain/langgraph`)**、**LangChain LCEL** 与 **Prisma 7 (PostgreSQL)** 构建的企业级智能体推理与对话核心微服务。

---

## 🚀 核心架构与功能

### 1. LangGraph 状态图推理闭环 (`src/llm/graph/`)
- **确定性状态机**：基于 `StateGraph` 与 `StateAnnotation` 契约，管理需求解析、分类、专家分析矩阵、生成草案与 Critic 评分报告。
- **Critic 审阅与自反思闭环**：通过条件边（Conditional Edge）基于结构化质检评分动态决策——未达阈值且在轮次上限内时触发 `revise` 循环重写，达标后流转至 `END` 交付。
- **领域专家子图 (Subgraph)**：解耦并独立编排业务领域专家分析器。

### 2. Artifacts 成果物全生命周期管理 (`src/artifact/`)
- **版本化数据库建模**：关联持久化 `Artifact` 与 `ArtifactVersion`，支持全量历史版本回溯、查看与对比。
- **针对性迭代优化**：提供 `OptimizeArtifactDto`，支持针对已有成果物进行局部/全局二次指令润色并派生新版本。

### 3. 模型配置管理与凭据安全体系 (`src/model-config/` & `src/common/crypto/`)
- **落库加密与接口脱敏**：私有模型 API Key 采用 `AES-256-GCM` 算法落库加密（前缀 `enc:v1:` 兼容历史明文）；对外管理接口强制脱敏脱空 (`maskSecrets` / `findByIdSafe`)。
- **运行时动态凭据解析**：公共公开模型统一走服务端环境变量；私有模型优先安全解密使用。
- **流式可观测 Meta 回传**：在 SSE `meta` 帧中向前端回传当前轮次实际使用的 `modelName` 与密钥来源 `keySource`。

### 4. RAG 知识库与异步任务流 (`src/document/` & `src/sse/`)
- **多格式文档解析**：支持 PDF、Word (`.docx`) 及纯文本。
- **切块与向量检索**：集成递归切块策略与向量相似度检索。
- **SSE 事件流通知**：长任务状态与进度实时通过 Server-Sent Events 推送。

---

## 📂 模块全景目录

```text
src/
├── artifact/              # 成果物与多版本迭代管理模块 (Controller, Service, DTOs)
├── common/                # 通用安全、异常拦截与工具库
│   └── crypto/            # AES-256-GCM 凭据加解密工具 (secret-crypto.ts)
├── config/                # LangChain 与环境配置加载器
├── conversation/          # 对话管理、UI 动作解析与 SSE 编排流式服务
├── document/              # 文档解析、切块与向量存储检索
├── llm/                   # 智能体核心算法与图编排
│   ├── agents/            # 领域专家 Agent 定义
│   ├── graph/             # LangGraph 状态图、节点实现、条件边与子图
│   └── tools/             # 沙箱与计算工具链
├── message/               # 消息记录与数据库操作
├── model-config/          # 模型动态配置、凭据解析与脱敏控制器
├── prisma/                # Prisma ORM 实例与模型类型导出
└── sse/                   # 异步长任务事件流通道 (TaskSseService)
```

---

## ⚙️ 环境变量配置

在 `services/chat/` 目录下创建 `.env` 文件：

```env
# 服务运行端口
PORT=4001

# 数据库持久化连接
DATABASE_URL="postgresql://postgres:postgres123@localhost:5432/autix_chat?schema=public"

# 默认大模型调用配置
MODEL_NAME=gpt-4o-mini
OPENAI_API_KEY=sk-your-default-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1

# JWT 统一鉴权密钥 (需与 user-system 保持一致)
JWT_SECRET="autix_rbac_jwt_secret_key_2026_super_secure"

# 模型配置密钥的落库加密密钥 (AES-256-GCM，建议 32 位强随机串)
# 未设置时回退使用 JWT_SECRET
MODEL_CONFIG_SECRET="your-32byte-secret-key-for-model-config"
```

---

## 🛠️ 常用开发与测试指令

```bash
# 启动本地开发服务 (支持代码热重载)
pnpm run dev

# 执行 TypeScript 静态类型检查
pnpm run typecheck

# 代码规范检查
pnpm run lint

# 执行单元测试
pnpm run test

# ----------------- LangGraph 智能体状态图测试 -----------------
# 运行端到端完整状态图推理
pnpm run test:graph

# 运行专家子图 (Subgraph) 独立测试
pnpm run test:subgraph

# 运行 Critic 质检评审与反思循环测试
pnpm run test:critic

# 终端输出 StateGraph 的 Mermaid 流程图源码
pnpm run graph:mermaid

# ----------------- 数据库管理 (Prisma) -----------------
# 同步 Prisma Schema 到数据库
pnpm run db:push

# 启动 Prisma Studio 可视化数据后台
pnpm run db:studio
```
