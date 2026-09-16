/**
 * 环境变量加载 —— 必须作为 main.ts 的第一个 import（副作用导入），
 * 保证后续模块求值期读取 process.env 时（如 auth.module 的 getJwtSecret）
 * 环境变量已经就位。
 *
 * 编译产物目录结构可能因 tsconfig rootDir 变化（dist/src/common 或 dist/common），
 * 因此不做单一路径假设：按候选列表探测第一个存在的 .env。
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

const candidates = [
  resolve(process.cwd(), '.env'), // nest start --watch 默认 cwd = 服务根目录
  resolve(here, '../../.env'), // dist/common 布局
  resolve(here, '../../../.env'), // dist/src/common 布局
  resolve(here, '../.env'), // 兜底
  resolve(here, '.env'), // 兜底
];

const envPath = candidates.find((p) => existsSync(p));
dotenv.config({ path: envPath ?? resolve(process.cwd(), '.env') });
