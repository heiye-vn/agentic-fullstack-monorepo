-- 第二十章 20.8：为 user-system 准备独立的库
--
-- 两个服务各有独立的库（chat 用 autix_chat，user-system 用 autix_rbac），
-- 这是本项目从一开始的约定。PG 官方镜像的 POSTGRES_DB 只能建一个库，
-- 第二个库靠 /docker-entrypoint-initdb.d 下的脚本补 —— 它只在数据卷为空
-- （首次初始化）时执行，重建容器不会重复建库，也不会影响已有数据。
--
-- 注意：不要在这里建表，表结构与迁移历史由 prisma migrate deploy 负责，
-- 手写建表会让 _prisma_migrations 与实际 schema 脱节。

SELECT 'CREATE DATABASE autix_rbac'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'autix_rbac')\gexec
