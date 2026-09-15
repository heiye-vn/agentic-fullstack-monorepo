# 智能体全栈实战教程库索引 (Tutorial Knowledge Index)

本项目配套实战教程库，记录了从工程底座搭建到 LangGraph 生产级智能体落地的完整演进链路。各章节与 Git 分支深度对应。

---

## 章节索引与分支映射表

| 序号 | 章节文件 | 对应 Git 分支 | 核心涵盖知识与技术要点 |
| :--- | :--- | :--- | :--- |
| 00 | [01_序章：站在范式之变的十字路口.md](./01_序章：站在范式之变的十字路口.md) | `main` | AI 驱动开发的思维转变、开发范式变革 |
| 01 | [02_第一章：把模型变成能力.md](./02_第一章：把模型变成能力.md) | - | 大模型调用、Prompt 模板设计、结构化输出初步 |
| 02 | [03_第二章：搭建智能体的工程底座.md](./03_第二章：搭建智能体的工程底座.md) | `chapter-01-monorepo-setup` / `feat/foundation` | Monorepo 工程结构、三层架构（clients/services/packages）、Docker Compose 底座 |
| 03 | [04_第二章：用AI接管工程化开发—从工程底座到能力链路.md](./04_第二章：用AI接管工程化开发—从工程底座到能力链路.md) | `chapter-02-user-system` / `feat/user-system` | AI 辅助规范化开发交付、RBAC 用户权限系统设计 |
| 04 | [05_第三章：LangChain起手—搭建第一条服务端能力链路.md](./05_第三章：LangChain起手—搭建第一条服务端能力链路.md) | `chapter-03-first-chain` / `feat/first-chain` | LangChain 服务端链路编排、LCEL 链式调用、能力封装 |
| 05 | [06_第四章：LangChain进阶—记忆、工具与多Agent.md](./06_第四章：LangChain进阶—记忆、工具与多Agent.md) | `chapter-04-agent-memory-tools` / `feat/agent-memory-tools` | 对话记忆（Memory）、Tools 工具调用、Multi-Agent 初步多角色协作 |
| 06 | [07_第五章：从Mock到生成—数据库设计与向量化落库.md](./07_第五章：从Mock到生成—数据库设计与向量化落库.md) | `chapter-05-db-vector` / `feat/db-vector` | PostgreSQL 数据库建模、Prisma、PgVector 向量化存储与检索持久化 |
| 07 | [08_第六章：让 AI 做更懂你的交互.md](./08_第六章：让 AI 做更懂你的交互.md) | `remotes/origin/chapter-06-ai-ui` / `feat/ai-ui` | AI 驱动 UI（Generative UI）、结构化组件协议（选择卡片/确认框/动态表单） |
| 08 | [09_第七章：Agent推理的三层决策机制—路由、执行与优化.md](./09_第七章：Agent推理的三层决策机制—路由、执行与优化.md) | - | 复杂 Agent 推理架构设计：路由层（Router）、执行层（Executor）、优化层（Optimizer） |
| 09 | [10_第八章：LangGraph单Agent图实战—路由、循环与质量闭环.md](./10_第八章：LangGraph单Agent图实战—路由、循环与质量闭环.md) | `chapter-08-langgraph` / `feat/LangGraph` | LangGraph 状态图设计：StateGraph、条件路由边、多步骤循环纠错与质量闭环 |

---

## AI 检索与阅读指引
- **分支关联**：当前工作区检出的 Git 分支（如 `chapter-08-langgraph`）与相应章节高度相关，代码实现应优先对齐该章节的设计理念与接口契约。
- **两阶段定位**：遇到特定模块或技术问题时，先查阅本索引找到匹配的章节，再使用 `view_file` 定向研读具体文件。
