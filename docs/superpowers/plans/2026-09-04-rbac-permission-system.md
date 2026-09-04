# RBAC 权限管理系统实施计划 (Implementation Plan)

> **执行者说明**：本计划严格遵循全栈工程化开发标准，分为 **Phase 1: 工程底座**、**Phase 2: 后端核心**、**Phase 3: 前端核心** 与 **Phase 4: 集成与收尾**。每个任务均具备独立的文件变更路径、接口输入输出、明确交付物与可量化的验收标准。

**目标**：在 Monorepo 中建立独立的后台管理系统 RBAC 权限中心，后端使用 NestJS + Prisma + PostgreSQL (`services/user-system`)，前端使用 Next.js + Tailwind 4 + HeroUI (`clients/admin-web`)。

**架构核心**：
- 细粒度三位一体权限控制（页面路由、按钮组件、后端 API 守卫）；
- 双 Token（Access + Refresh Token 落库 Hash 存储）安全认证与静默刷新；
- 基于 `tokenVersion` 的角色权限变更即时失效机制；
- 超级管理员 `super_admin` / `*:*:*` 统一放行机制；
- 组织部门树与软删除体系，以及完整的登录/操作审计日志。

---

## 全局约束与技术栈基准

| 层次 | 技术选型 / 规范 | 说明 |
| :--- | :--- | :--- |
| 包管理与编排 | pnpm@10 + Turborepo | 保持 Monorepo 拓扑一致性，共享 `@autix/contracts` |
| 后端服务 | NestJS 12 + Prisma ORM + PostgreSQL | 端口 `4002`，目录 `services/user-system` |
| 前端应用 | Next.js 16 (App Router) + Tailwind CSS 4 + HeroUI | 端口 `3003`，目录 `clients/admin-web` |
| 密码学与安全 | Argon2id / bcrypt + Passport JWT | Refresh Token 哈希持久化于数据库 |
| 权限编码规范 | `模块:实体:动作` | 例如 `sys:user:create`, `sys:role:assign`, `sys:dept:delete` |

---

## Phase 1: 工程底座 (Foundation)

### Task 1.1: 基础 Monorepo 工作区与服务脚手架扩展
**职责**：创建独立的前后端项目目录，配置 Monorepo 拓扑与 TypeScript 继承。
**涉及文件**：
- 新增：`services/user-system/package.json`
- 新增：`services/user-system/tsconfig.json`
- 新增：`services/user-system/src/main.ts`
- 新增：`services/user-system/src/app.module.ts`
- 新增：`clients/admin-web/package.json`
- 新增：`clients/admin-web/tsconfig.json`
- 修改：`pnpm-workspace.yaml`
- 修改：`turbo.json`
- 修改：`package.json` (根目录)

**步骤**：
- [x] 1. 建立 `services/user-system` 基础 NestJS 结构，配置监听端口 `4002`，引入 `@autix/contracts` 依赖。
- [x] 2. 建立 `clients/admin-web` 基础 Next.js 结构，配置启动端口 `3003`。
- [x] 3. 更新根目录 `package.json`，补充 `dev:user-system` 与 `dev:admin-web` 快捷脚本，配置 Turbo 管道。
- [x] 4. 执行类型检查与启动验证。

**交付物**：可独立启动、具备 Monorepo 软链接能力的 `@autix/user-system` 与 `@autix/admin-web` 基础工程。
**验收标准**：
- 根目录下运行 `pnpm dev:user-system`，后端成功启动并在 `http://localhost:4002` 监听。
- 根目录下运行 `pnpm dev:admin-web`，前端成功启动并在 `http://localhost:3003` 渲染基础页。

---

### Task 1.2: 数据库基础设施与 Prisma 环境搭建
**职责**：在本地容器编排中提供 PostgreSQL 实例，并初始化 Prisma 基础设施。
**涉及文件**：
- 修改：`infra/compose/compose.dev.yaml`
- 新增：`services/user-system/prisma/schema.prisma`
- 新增：`services/user-system/.env.example`
- 新增：`services/user-system/.env`
- 新增：`services/user-system/src/prisma/prisma.service.ts`
- 新增：`services/user-system/src/prisma/prisma.module.ts`

**步骤**：
- [x] 1. 在 `infra/compose/compose.dev.yaml` 增加 `postgres` 数据库服务（端口 `5432`，用户密码及持久化数据卷配置）。
- [x] 2. 在 `services/user-system` 安装 `prisma` 与 `@prisma/client`。
- [x] 3. 初始化 `schema.prisma` 基础配置（数据源类型为 `postgresql`），配置 `DATABASE_URL`。
- [x] 4. 封装全局 `PrismaService`，挂载连接与销毁生命周期钩子，注册全局 `PrismaModule`。

**交付物**：PostgreSQL 容器化运行配置与全局单例 `PrismaService` 数据访问层。
**验收标准**：
- `docker compose` 成功拉起 PostgreSQL，容器健康检查通过。
- `user-system` 启动时 `PrismaService` 成功与数据库建立连接无报错。

---

### Task 1.3: RBAC 数据库 Schema 设计与迁移 (独立数据建模)
**职责**：精确定义完整 RBAC 实体关系模型、审计模型与软删除字段。
**涉及文件**：
- 修改：`services/user-system/prisma/schema.prisma`
- 新增：`services/user-system/prisma/migrations/*_init_rbac_schema/migration.sql`

**数据实体清单**：
1. `Department`: `id`, `name`, `code`, `parentId`, `sortOrder`, `leader`, `phone`, `status`, `createdAt`, `updatedAt`, `deletedAt`
2. `User`: `id`, `username`, `passwordHash`, `realName`, `email`, `phone`, `avatar`, `status`, `departmentId`, `tokenVersion`, `lastLoginAt`, `createdAt`, `updatedAt`, `deletedAt`
3. `Role`: `id`, `name`, `code`, `description`, `sortOrder`, `status`, `createdAt`, `updatedAt`, `deletedAt`
4. `Permission`: `id`, `parentId`, `name`, `code`, `type` (CATALOG/MENU/BUTTON/API), `path`, `component`, `icon`, `sortOrder`, `status`, `createdAt`, `updatedAt`
5. `UserRole`: `userId`, `roleId`, `createdAt`（复合主键）
6. `RolePermission`: `roleId`, `permissionId`, `createdAt`（复合主键）
7. `RefreshToken`: `id`, `userId`, `tokenHash`, `deviceId`, `expiresAt`, `revokedAt`, `createdAt`
8. `LoginLog`: `id`, `username`, `ip`, `userAgent`, `status`, `message`, `loginAt`
9. `OperationLog`: `id`, `userId`, `username`, `module`, `action`, `method`, `path`, `params`, `status`, `duration`, `errorMessage`, `createdAt`

**步骤**：
- [x] 1. 编写完整的 `schema.prisma` 模型、外键关系与索引配置。
- [x] 2. 执行 `npx prisma migrate dev --name init_rbac_schema` 生成 SQL 迁移。
- [x] 3. 校验自动生成的 TypeScript 类型定义文件。

**交付物**：完整的 Prisma 数据建模文件与初始迁移文件。
**验收标准**：
- 迁移脚本在 PostgreSQL 中完整执行，9 张实体表及对应索引全部成功创建。
- Prisma Client 生成所有类型，代码中可直接引用 `User`, `Role`, `Permission` 等强类型。

---

## Phase 2: 后端核心 (Backend Core)

### Task 2.1: 认证鉴权核心模块 (Auth Module)
**职责**：双 Token 颁发、密码散列、Refresh Token 落库与吊销、登录/登出处理。
**涉及文件**：
- 新增：`services/user-system/src/modules/auth/auth.module.ts`
- 新增：`services/user-system/src/modules/auth/auth.controller.ts`
- 新增：`services/user-system/src/modules/auth/auth.service.ts`
- 新增：`services/user-system/src/modules/auth/dto/login.dto.ts`
- 新增：`services/user-system/src/modules/auth/dto/refresh-token.dto.ts`
- 新增：`services/user-system/src/modules/auth/strategies/jwt.strategy.ts`
- 测试：`services/user-system/test/auth.spec.ts`

**步骤**：
- [x] 1. 集成 `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `argon2`。
- [x] 2. 实现 `AuthService.login()`：校验账号密码与账号启用状态；签发 Access Token (包含 `sub`, `username`, `tokenVersion`)；生成高随机 Refresh Token 计算 SHA256 哈希存入 `RefreshToken` 表；异步记录 `LoginLog`。
- [x] 3. 实现 `AuthService.refreshToken()`：比对 Hash、过期时间与吊销标记；若验证通过，颁发新 Access Token 与滚动 Refresh Token。
- [x] 4. 实现 `AuthService.logout()`：根据用户当前凭证精确吊销该条 `RefreshToken` 记录。
- [x] 5. 编写针对登录与 Token 刷新链路的测试用例。

**交付物**：完整的用户认证控制器与鉴权服务，提供 `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout` 接口。
**验收标准**：
- 密码输入错误时返回 400/401 并沉淀失败日志。
- 登录成功返回双 Token，数据库中可见对应 Hash。
- 使用有效 Refresh Token 能成功刷新 Access Token；登出后已吊销的 Refresh Token 无法再次使用。

---

### Task 2.2: RBAC 守卫与装饰器架构 (Guards & Decorators)
**职责**：实现权限注解、JWT 校验守卫与权限判定守卫，集成 `super_admin` 放行和 `tokenVersion` 动态失效机制。
**涉及文件**：
- 新增：`services/user-system/src/common/decorators/require-permissions.decorator.ts`
- 新增：`services/user-system/src/common/decorators/current-user.decorator.ts`
- 新增：`services/user-system/src/common/guards/jwt-auth.guard.ts`
- 新增：`services/user-system/src/common/guards/permissions.guard.ts`

**步骤**：
- [x] 1. 编写 `@RequirePermissions(...permissions: string[])` 装饰器，基于 `Reflector` 元数据机制存入方法。
- [x] 2. 实现 `JwtAuthGuard`：校验 Token 有效期与签名；配合 JwtStrategy 根据 Payload 中的 `sub` 与 `tokenVersion` 实时比对 DB 中 `User.tokenVersion`；若版本滞后则抛出 401 凭证过期异常；支持 `@Public()` 免认证路由。
- [x] 3. 实现 `PermissionsGuard`：
  - 提取当前登录用户的角色列表；若包含 `super_admin`，直接放行（`return true`）。
  - 聚合用户各角色关联的所有权限编码列表；若包含 `*:*:*` 或满足接口全部/任一所需权限码，放行；支持前缀通配（如 `sys:user:*`）；否则抛出 403 Forbidden 异常。
- [x] 4. 封装统一的异常响应与 `@CurrentUser()` 参数装饰器。

**交付物**：通用的鉴权守卫与权限注解工具集。
**验收标准**：
- 在测试路由标记 `@RequirePermissions('sys:test:view')`：
  - 无 Token 请求返回 `401 Unauthorized`；
  - 拥有 `super_admin` 角色用户无阻碍通过；
  - 普通用户具备该权限码时返回 200，无权限时精准拦截并返回 `403 Forbidden`。

---

### Task 2.3: 用户管理业务模块 (Users Module)
**职责**：用户实体的 CRUD、条件筛选（按部门、关键字、状态）、密码重置与角色绑定。
**涉及文件**：
- 新增：`services/user-system/src/modules/users/users.module.ts`
- 新增：`services/user-system/src/modules/users/users.controller.ts`
- 新增：`services/user-system/src/modules/users/users.service.ts`
- 新增：`services/user-system/src/modules/users/dto/create-user.dto.ts`
- 新增：`services/user-system/src/modules/users/dto/query-user.dto.ts`
- 新增：`services/user-system/src/modules/users/dto/assign-roles.dto.ts`

**步骤**：
- [x] 1. 实现 `POST /api/v1/users`（创建用户，密码加密存储，支持关联部门）。
- [x] 2. 实现 `GET /api/v1/users`（分页查询用户列表，支持按关键字模糊检索，自动过滤 `deletedAt IS NOT NULL` 软删除记录）。
- [x] 3. 实现 `PUT /api/v1/users/:id/roles`（用户�**步骤**：
- [x] 1. 安装配置 `@heroui/react`, `framer-motion`, `lucide-react`, `axios`, `zustand`。
- [x] 2. 配置 Tailwind 4 主题色彩变量与 HeroUI Provider。
- [x] 3. 封装 `apiClient`：
  - 请求拦截器：自动在 Headers 注入 `Authorization: Bearer <accessToken>`。
  - 响应拦截器：当捕获 `401` 且非重试请求时，通过挂起 Promise 队列调用 `/auth/refresh` 刷新 Token；换票成功后重放原请求；换票失败则清理状态重定向至 `/login`。

**交付物**：带有设计系统与健全网络请求层的前端基础底座。
**验收标准**：
- 在页面中可成功渲染 HeroUI 按钮与卡片样式无报错。
- 401 模拟测试中，能够无缝完成静默刷新并重新提交原请求。

---

### Task 3.2: 登录与身份状态管理 (Login & Session Store)
**职责**：构建精致登录页，基于 Zustand 管理登录凭证与权限码，配置路由中间件。
**涉及文件**：
- 新增：`clients/admin-web/app/login/page.tsx`
- 新增：`clients/admin-web/stores/auth-store.ts`
- 新增：`clients/admin-web/proxy.ts`

**步骤**：
- [x] 1. 使用 HeroUI 表单组件打造高水准深色/浅色自适应登录界面（账号、密码输入框、状态提示与登录按钮）。
- [x] 2. 编写 `useAuthStore`：存储 `user`, `accessToken`, `permissions: string[]`，支持持久化存储与登出清理。
- [x] 3. 编写 Next.js `proxy.ts`：对非 `/login` 路由检查登录状态，未授权重定向至 `/login`。

**交付物**：用户登录页面、全局会话存储与路由安全拦截。
**验收标准**：
- 访问受保护路由自动重定向到登录页面；输入账号密码登录后，存储 Token 并成功进入后台首页。

---

### Task 3.3: 后台布局与动态权限侧边栏 (Layout & Dynamic Navigation)
**职责**：实现后台主布局框架，由权限码驱动菜单树渲染，封装按钮级细粒度权限控制组件。
**涉及文件**：
- 新增：`clients/admin-web/app/(dashboard)/layout.tsx`
- 新增：`clients/admin-web/components/layout/sidebar.tsx`
- 新增：`clients/admin-web/components/layout/header.tsx`
- 新增：`clients/admin-web/components/auth/auth-guard.tsx`
- 新增：`clients/admin-web/hooks/use-permissions.ts`
- 新增：`clients/admin-web/config/menu-config.ts`

**步骤**：
- [x] 1. 编写 `menu-config.ts` 定义系统路由元数据（路径、名称、Icon、所需权限码 `permission`）。
- [x] 2. 实现 `Sidebar` 导航组件：读取 `useAuthStore` 中的 `permissions`，动态过滤用户无权访问的菜单项。
- [x] 3. 实现 `Header`：包含用户头像、所属角色、个人中心入口与退出登录按钮。
- [x] 4. 封装 `<AuthGuard permission="sys:user:delete">` 与 `usePermissions()` Hook。

**交付物**：响应式管理后台主架构与细粒度权限控制组件。
**验收标准**：
- 用户分配不同角色时，侧边栏菜单精确按权限展示。
- 使用 `<AuthGuard>` 包裹的按钮在无权限时自动隐藏或置灰。

---

### Task 3.4: 业务模块一：用户管理中心 (User Management Page)
**职责**：用户列表查询、部门筛选树、新增/编辑用户 Drawer、分配角色 Drawer。
**涉及文件**：
- 新增：`clients/admin-web/app/(dashboard)/users/page.tsx`
- 新增：`clients/admin-web/components/common/right-drawer.tsx`

**步骤**：
- [x] 1. 构建部门筛选 + 用户 Table 联动视图。
- [x] 2. Table 支持按姓名/账号/手机号搜索、状态快捷启停、分页操作。
- [x] 3. 实现用户新增/编辑右侧划入抽屉 Drawer（校验账号、邮箱、部门必选）。
- [x] 4. 实现分配角色 Drawer（多选角色 Checkbox），保存后调用角色分配接口。

**交付物**：现代化的用户管理全功能操作界面。
**验收标准**：
- 可完成用户创建、编辑、状态切换、关联部门与分配角色，界面交互流畅并具备 Loading / Toast 提示。

---

### Task 3.5: 业务模块二：角色与权限配置中心 (Role & Permission Page)
**职责**：角色列表、角色权限树可视化勾选配置 Drawer、权限资源列表。
**涉及文件**：
- 新增：`clients/admin-web/app/(dashboard)/roles/page.tsx`
- 新增：`clients/admin-web/app/(dashboard)/permission-center/page.tsx`

**步骤**：
- [x] 1. 实现角色列表表格（展示角色名称、角色编码、描述、创建时间、操作区）。
- [x] 2. 实现权限树抽屉：递归渲染权限树结构，按系统/菜单/按钮分组，支持父子级联选中、全选/全消，保存角色对应的权限集合。
- [x] 3. 针对 `super_admin` 角色禁用编辑与删除按钮。
- [x] 4. 实现权限配置中心页，查看与管理当前系统定义的菜单与按钮权限树。

**交付物**：直观的角色权限可视化管理与授权配置中心。
**验收标准**：
- 打开角色授权抽屉能清晰看到树形复选框，选中并保存后后端成功更新关联，再次打开回显正确。

---

### Task 3.6: 业务模块三：组织架构与审计中心 (Dept & Logs Page)
**职责**：部门树形管理页面、登录日志与操作日志审计看板、个人信息管理。
**涉及文件**：
- 新增：`clients/admin-web/app/(dashboard)/departments/page.tsx`
- 新增：`clients/admin-web/app/(dashboard)/logs/page.tsx`
- 新增：`clients/admin-web/app/(dashboard)/profile/page.tsx`

**步骤**：
- [x] 1. 部门管理：树形表格展示，支持折叠展开、快捷新增子部门抽屉。
- [x] 2. 审计日志看板：
  - 登录日志：展示登录用户、IP、浏览器、时间、登录状态。
  - 操作日志：展示操作人、业务模块、请求路径、耗时、查看请求参数详情 Drawer。
- [x] 3. 个人中心页：展示个人资料，支持修改个人密码与查看当前安全状态。

**交付物**：完整的部门组织维护界面、审计合规流水界面与个人信息管理页。
**验收标准**：
- 部门树层级正确展示；审计日志按时间倒序清晰展示，支持参数详情抽屉查看。

---

## Phase 4: 集成与收尾 (Integration & Polish)

### Task 4.1: 数据库种子数据与系统初始化 (Prisma Seed)
**职责**：编写自动化的种子脚本，初始化系统根部门、超级管理员账号、默认角色以及系统全量菜单权限树。
**涉及文件**：
- 新增：`services/user-system/prisma/seed.ts`
- 修改：`services/user-system/package.json` (增加 `prisma.seed` 配置)

**步骤**：
- [x] 1. 编写 `seed.ts`：
  - 创建根部门 `总公司`；
  - 创建核心权限树（系统管理、用户管理、角色管理、部门管理、审计日志以及对应增删改查按钮权限码）；
  - 创建角色 `super_admin`（绑定 `*:*:*`）与 `general_user`（绑定基础菜单）；
  - 创建默认超级管理员账号 `admin`（密码 `Admin123!`，采用 Argon2 加密）。
- [x] 2. 配置 `package.json` 中的 `pnpm prisma db seed` 钩子并执行测试。

**交付物**：一键初始化的数据库种子脚本。
**验收标准**：
- 执行 `pnpm --filter @autix/user-system prisma db seed` 后，数据库瞬间填充完备的初始化可用数据。

---

### Task 4.2: 前后端端到端联调与权限生命周期闭环验证
**职责**：对核心链路进行全面联合调试与异常渗透测试。
**涉及文件**：
- 调整联调中发现的问题文件。

**测试用例与验证链路**：
- [x] 1. **认证闭环**：使用 `admin` / `Admin123!` 登录后台，检查 Token 存储与请求头自动携带。
- [x] 2. **越权防御**：普通用户直接在前端输入无权访问的 URL 路径（如 `/system/roles`），验证路由守卫重定向或 403；直接调用后端 API，验证 `PermissionsGuard` 403 拦截。
- [x] 3. **即时生效验证**：在管理员窗口修改某在线测试用户的角色权限，验证该用户在无感换票或下次操作时立即受限（基于 `tokenVersion`）。
- [x] 4. **静默刷新验证**：人为修改前端 Access Token 为过期时间，触发接口调用，验证是否自动触发 `/auth/refresh` 并且业务请求未中断无感成功。
- [x] 5. **审计完整性验证**：执行一系列写操作后进入日志中心，确认每笔操作的操作人、耗时、入参脱敏均被准确记录。

**交付物**：端到端测试用例执行记录与联调修复。
**验收标准**：上述 5 条核心链路全部测试通过，控制台无报错。

---

### Task 4.3: 本地启动脚本、环境变量与工程文档归档
**职责**：梳理整体环境变量模版，规范一键启动脚本，更新项目 README。
**涉及文件**：
- 修改：`README.md`
- 新增：`services/user-system/.env.example`
- 新增：`clients/admin-web/.env.example`
- 修改：`package.json` (根目录)

**步骤**：
- [x] 1. 整理前后端 `.env.example`，明确标注各项环境变量含义（如 `JWT_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_API_URL`）。
- [x] 2. 根目录 `package.json` 整合统一命令：
  - `pnpm dev:rbac`：并发拉起 PostgreSQL、user-system (4002) 与 admin-web (3003)。
- [x] 3. 在 `README.md` 中编写 RBAC 模块启动与开发指南。

**交付物**：开箱即用的开发文档与一键启动流水线。
**验收标准**：全新机器克隆仓库后，仅需 `pnpm install && pnpm dev:rbac` 即可完整拉起全套系统。
