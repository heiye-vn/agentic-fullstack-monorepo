import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from '@autix/contracts';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 默认 workspace 根目录：
 * business.tools.ts 位于 services/chat/src/llm/tools/
 * 向外三级即 services/chat，再拼接 workspace/
 */
export const DEFAULT_WORKSPACE_ROOT = path.resolve(
  __dirname,
  '../../../workspace',
);

/**
 * safePath 沙箱路径校验函数
 * 确保所有文件操作严格限制在 workspace/ 目录内，杜绝路径遍历（Path Traversal）漏洞
 *
 * @param userInputPath 用户或模型提供的相对路径
 * @param baseDir 自定义根目录（默认采用 DEFAULT_WORKSPACE_ROOT 或环境变量）
 * @returns 解析后的绝对安全路径
 */
export function resolveSafePath(
  userInputPath: string,
  baseDir?: string,
): string {
  const rootDir = path.resolve(
    baseDir ?? process.env.CHAT_WORKSPACE_DIR ?? DEFAULT_WORKSPACE_ROOT,
  );
  let cleanPath = (userInputPath ?? '').trim();

  if (!cleanPath) {
    throw new Error('路径参数不能为空');
  }

  // 阻断空字符截断攻击
  if (cleanPath.includes('\0')) {
    throw new Error('非法路径：检测到空字符注入');
  }

  // 容错处理：若模型或用户误带 workspace/ 或 workspace\ 前缀，自动清洗剔除
  if (
    cleanPath.startsWith('workspace/') ||
    cleanPath.startsWith('workspace\\')
  ) {
    cleanPath = cleanPath.slice('workspace/'.length).trim();
  } else if (cleanPath === 'workspace') {
    cleanPath = '.';
  }

  // 解析并计算相对路径
  const resolvedPath = path.resolve(rootDir, cleanPath);
  const relative = path.relative(rootDir, resolvedPath);

  // 越界检查：若相对路径以 .. 开头或为绝对路径（例如跨盘符），则判定为非法越界
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `安全沙箱限制：拒绝访问 workspace 外部路径【${userInputPath}】`,
    );
  }

  return resolvedPath;
}

// ============================================================
// 1. 需求单详情查询工具 (query_requirement)
// ============================================================

const QueryRequirementInputSchema = z.object({
  requirementId: z.string().describe('需求单编号，例如：“REQ-2026-001”'),
});

export type QueryRequirementInput = z.infer<typeof QueryRequirementInputSchema>;

export const queryRequirementTool = tool(
  async (input: QueryRequirementInput): Promise<string> => {
    const rawId = input.requirementId?.trim() ?? '';
    if (!rawId) {
      return JSON.stringify({
        success: false,
        error: '需求单编号不能为空',
      });
    }

    // 清理单号末尾可能误带的 .json 后缀
    const normalizedId = rawId.endsWith('.json') ? rawId.slice(0, -5) : rawId;

    // 安全校验单号字符，防止利用单号进行目录跳转
    if (/[/\\]/.test(normalizedId) || normalizedId.includes('..')) {
      return JSON.stringify({
        success: false,
        error: `非法需求单编号格式【${rawId}】，单号中不能包含路径分隔符或跳转符号`,
      });
    }

    const relPath = `requirements/${normalizedId}.json`;
    let targetPath: string;
    try {
      targetPath = resolveSafePath(relPath);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!existsSync(targetPath)) {
      return JSON.stringify({
        success: false,
        found: false,
        requirementId: normalizedId,
        message: `未找到需求单【${normalizedId}】，文件路径【${relPath}】不存在`,
      });
    }

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      // 验证是否是合法 JSON
      try {
        const parsed = JSON.parse(content);
        return JSON.stringify({
          success: true,
          found: true,
          requirementId: normalizedId,
          data: parsed,
        });
      } catch {
        return JSON.stringify({
          success: true,
          found: true,
          requirementId: normalizedId,
          rawContent: content,
        });
      }
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `读取需求单失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
  {
    name: 'query_requirement',
    description:
      '根据需求单号查询需求详情。自动读取 workspace/requirements/{requirementId}.json 文件，返回需求的标题、功能、目标、约束等完整数据',
    schema: QueryRequirementInputSchema,
  },
);

// ============================================================
// 2. 文件读取工具 (read_file)
// ============================================================

const ReadFileInputSchema = z.object({
  filePath: z
    .string()
    .describe(
      '相对于 workspace 目录的文件路径，例如：“standards/requirement-spec.md”',
    ),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

export const readFileTool = tool(
  async (input: ReadFileInput): Promise<string> => {
    const rawPath = input.filePath?.trim() ?? '';
    if (!rawPath) {
      return JSON.stringify({
        success: false,
        error: '文件路径不能为空',
      });
    }

    let targetPath: string;
    try {
      targetPath = resolveSafePath(rawPath);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!existsSync(targetPath)) {
      return JSON.stringify({
        success: false,
        found: false,
        filePath: rawPath,
        message: `文件【${rawPath}】不存在，无法读取`,
      });
    }

    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        return JSON.stringify({
          success: false,
          error: `目标路径【${rawPath}】是目录，并非文件，无法读取内容`,
        });
      }

      const content = await fs.readFile(targetPath, 'utf-8');
      return JSON.stringify({
        success: true,
        found: true,
        filePath: rawPath,
        sizeBytes: stat.size,
        content,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `读取文件失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
  {
    name: 'read_file',
    description:
      '读取 workspace/ 目录下指定路径的文件内容（如标准规范文档 standards/requirement-spec.md 等）。路径相对于 workspace/，严禁带有 workspace/ 前缀',
    schema: ReadFileInputSchema,
  },
);

// ============================================================
// 3. 文件写入工具 (write_file)
// ============================================================

const WriteFileInputSchema = z.object({
  filePath: z
    .string()
    .describe(
      '相对于 workspace 目录的文件路径，例如：“reports/REQ-2026-001-analysis.md”',
    ),
  content: z
    .string()
    .describe('需要写入文件的完整文本内容（Markdown 或纯文本）'),
});

export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export const writeFileTool = tool(
  async (input: WriteFileInput): Promise<string> => {
    const rawPath = input.filePath?.trim() ?? '';
    if (!rawPath) {
      return JSON.stringify({
        success: false,
        error: '目标文件路径不能为空',
      });
    }

    let targetPath: string;
    try {
      targetPath = resolveSafePath(rawPath);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      // 自动递归创建父目录
      const parentDir = path.dirname(targetPath);
      await fs.mkdir(parentDir, { recursive: true });

      const content = input.content ?? '';
      await fs.writeFile(targetPath, content, 'utf-8');

      return JSON.stringify({
        success: true,
        filePath: rawPath,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        message: `文件【${rawPath}】写入成功`,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `写入文件失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
  {
    name: 'write_file',
    description:
      '将内容写入 workspace/ 目录下指定路径（如分析报告 reports/REQ-2026-001-analysis.md 等）。若目标父文件夹不存在将自动创建。路径相对于 workspace/，严禁带有 workspace/ 前缀',
    schema: WriteFileInputSchema,
  },
);

// ============================================================
// 导出工具集与字典
// ============================================================

export const businessTools = [
  queryRequirementTool,
  readFileTool,
  writeFileTool,
];

export const businessToolsByName: Record<string, StructuredToolInterface> = {
  [queryRequirementTool.name]: queryRequirementTool,
  [readFileTool.name]: readFileTool,
  [writeFileTool.name]: writeFileTool,
};
