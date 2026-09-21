/**
 * scripts/deepagent-env.ts — 第十四、十五章 DeepAgent 脚本共享环境
 *
 * 统一处理三件每个脚本都要做的事：
 *   1. 加载 services/chat/.env（dotenv，Windows 绝对路径）
 *   2. 构造 DeepAgent 用的 ChatOpenAI（模型可用 DEEPAGENT_MODEL 覆盖）
 *   3. 定位 Skill 资产目录、从消息链里提取工具调用链
 *
 * 之所以抽出来：六个脚本都要重复这段装配，而它们只有「业务工具和 prompt 不同」。
 */
import { config } from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSkillTools } from '../src/skills/skill-tools.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** services/chat 根目录 */
export const SERVICE_ROOT = join(HERE, '..');

/** 第十三章沉淀的 Skill 资产目录（内含两个 SKILL.md） */
export const SKILLS_DIR = join(SERVICE_ROOT, 'src', 'skills', 'definitions');

/** 相对 backend rootDir 的 Skill 路径，配合 FilesystemBackend 使用 */
export const SKILLS_BACKEND_RELATIVE = 'src/skills/definitions';

config({ path: join(SERVICE_ROOT, '.env') });

/**
 * 构造 DeepAgent 主模型。
 *
 * 默认取 weak 档位 qwen3.7-flash-2026-07-15（strong 档 qwen3.8-max 免费额度已耗尽）。
 * 弱档位 tool calling 不如强档稳定，write_todos 更难触发属正常现象；
 * 需要更强规划能力时用 DEEPAGENT_MODEL 覆盖。
 */
export function buildDeepAgentModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: process.env.DEEPAGENT_MODEL || 'qwen3.7-flash-2026-07-15',
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });
}

/** 没有 key 时给出明确提示，避免脚本抛一长串 401 堆栈 */
export function requireApiKey(): boolean {
  if (process.env.OPENAI_API_KEY) return true;
  console.error(
    '缺少 OPENAI_API_KEY。请在 services/chat/.env 中配置，或设置 DEEPAGENT_MODEL 指定可用模型。',
  );
  return false;
}

/** 取第十三章的两个需求分析本地工具（analyze_completeness / estimate_complexity） */
export function buildAnalysisTools() {
  const byName = new Map(createSkillTools().map((t) => [t.name, t]));
  return ['analyze_completeness', 'estimate_complexity']
    .map((n) => byName.get(n))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
}

/** 从 messages 里抽出工具调用顺序，如 "write_todos → analyze_completeness" */
export function toolChain(messages: any[]): string[] {
  return (messages ?? [])
    .filter((m: any) => m?.tool_calls?.length > 0)
    .flatMap((m: any) => m.tool_calls.map((tc: any) => tc?.name).filter(Boolean));
}

/** 取最后一条消息的文本 */
export function lastText(messages: any[]): string {
  const last = (messages ?? []).at(-1);
  if (!last) return '(无输出)';
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
}

export function section(title: string) {
  const line = '='.repeat(78);
  console.log(`\n${line}\n${title}\n${line}`);
}
