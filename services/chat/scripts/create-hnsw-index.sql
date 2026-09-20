-- ========================================================================
-- create-hnsw-index.sql
-- 第十一章 11.5.6 — pgvector HNSW 索引构建脚本
-- ========================================================================
-- 核心工程规范与运维注意事项：
-- 1. 【先全量入库再建索引】：
--    HNSW 索引构建过程基于层次化小世界图，属于密集计算与内存消耗型操作。
--    在空表上预先建立 HNSW 索引会导致后续逐条/小批量插入时频繁触发图剪枝与重平衡，
--    插入吞吐大幅下降；正确的生产实践是：先完成历史知识库数据的批量向量化全量入库，
--    再单次执行本脚本创建 HNSW 索引，构建速度可提升 10 倍以上，且生成的索引图拓扑更加紧凑均衡。
-- 2. 【运维手动审批执行】：
--    本脚本独立存放在 scripts/ 目录，避免作为常规 Prisma 自动迁移在应用部署启动时
--    自动阻塞数据库连接池；建议在业务维护窗口由 DBA/运维工程师手动执行并观察系统负载。
-- ========================================================================

-- 1. 启用 pgvector 向量计算扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 在 document_chunks 表的 embedding 字段上创建 HNSW 索引
-- 参数说明：
--   - USING hnsw: 指定使用分层可导航小世界（Hierarchical Navigable Small World）算法
--   - vector_cosine_ops: 余弦距离操作符类（对应 <=> 操作符，用于 1 - cosine 相似度计算）
--   - m = 16: 每个节点的最大双向图连接数（权衡索引内存大小与召回精度）
--   - ef_construction = 64: 索引构建期间探索的近邻候选列表大小（越大建图质量越高，建索引耗时越长）
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
ON document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. 查询性能调优提示（可选）：
-- 检索会话或数据库全局可配置 ef_search 参数，在召回率与查询延迟之间调优（默认值为 40）：
-- SET hnsw.ef_search = 100;
