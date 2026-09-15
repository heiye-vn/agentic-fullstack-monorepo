# 项目专属 Agent 协作与上下文感知规范

本项目为全栈智能体单体多包仓库（Agentic Fullstack Monorepo）。在进行需求分析、代码编写、架构设计或问题排查时，必须严格遵守以下协作协议。

---

## 1. 教程知识库两阶段研读协议 (Two-Stage Tutorial Protocol)

本地存在与项目分支和演进历程一一对应的教程知识库：[docs/tutorials/](./docs/tutorials/)。

在处理任何涉及具体业务功能开发、重构或架构问题时，必须执行以下两阶段：

1. **第一阶段（索引与分支对齐）**：
   - 首先查阅 [docs/tutorials/README.md](./docs/tutorials/README.md) 了解全套教程章节与分支映射。
   - 识别当前所在 Git 分支（例如 `chapter-08-langgraph` 对应第八章 LangGraph 实战）。
2. **第二阶段（精准研读）**：
   - 根据用户提问的主题以及当前分支，使用 `view_file` 定向研读对应章节的 Markdown 文件（如涉及状态图流转研读 `10_第八章：LangGraph单Agent图实战—路由、循环与质量闭环.md`，涉及 UI 协议研读 `08_第六章：让 AI 做更懂你的交互.md` 等）。
   - 代码实现风格、分层架构、状态机模型与命名契约必须与教程内容保持一致。

---

## 2. 架构设计与代码一致性

- **服务分层**：严格遵循 `clients/`（前端）、`services/`（后端微服务）、`packages/`（共享库）的职责划分。
- **状态与图设计**：凡是涉及 LangGraph / LangChain 的实现，状态定义（StateAnnotation）、边流转（Edges）、节点（Nodes）处理必须保持类型安全和错误边界控制。
