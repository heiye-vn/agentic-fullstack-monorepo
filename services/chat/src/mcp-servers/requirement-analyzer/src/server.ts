/**
 * services/chat/mcp-servers/requirement-analyzer/src/server.ts
 *
 * 第十二章 12.4 — Requirement Analyzer MCP Server
 *
 * 对外暴露：
 * - Tools（模型控制调用）：analyze_completeness / estimate_complexity /
 *   check_conflicts / generate_user_stories
 * - Resources（应用控制读取）：requirement://templates/prd、
 *   requirement://standards/acceptance-criteria
 * - Prompts（用户控制选择）：analyze_requirement
 *
 * 之所以把「构造 Server」做成工厂而不是在模块顶层直接 new，
 * 是为了让客户端可以在进程内用 InMemoryTransport 直接连真实实现做集成测试，
 * 而不必真的 fork 一个子进程。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  analyzeCompleteness,
  estimateComplexity,
  checkConflicts,
  generateUserStories,
} from './analyzers.js';

export const REQUIREMENT_ANALYZER_NAME = 'requirement-analyzer';
export const REQUIREMENT_ANALYZER_VERSION = '1.0.0';

export const PRD_TEMPLATE_URI = 'requirement://templates/prd';
export const ACCEPTANCE_CRITERIA_URI =
  'requirement://standards/acceptance-criteria';

const PRD_TEMPLATE = `# PRD: [需求标题]

## 1. 背景与目标
- 业务背景：
- 用户痛点：
- 预期目标：

## 2. 用户角色
| 角色 | 描述 | 核心诉求 |
|------|------|----------|

## 3. 功能需求
### 3.1 核心功能
### 3.2 辅助功能

## 4. 非功能需求
- 性能：
- 安全：
- 可用性：

## 5. 验收标准
- Given [前置条件]
- When [用户操作]
- Then [预期结果]

## 6. 排期与里程碑`;

const ACCEPTANCE_CRITERIA_STANDARD = `# 验收标准编写规范

## Given-When-Then 格式
- Given [前置条件]
- When [用户操作]
- Then [预期结果]

## 检查清单
- [ ] 是否覆盖了正常流程
- [ ] 是否覆盖了异常流程
- [ ] 是否定义了边界条件
- [ ] 是否包含性能指标
- [ ] 是否可自动化测试

## 示例
Given 用户已登录且有管理员权限
When 用户点击「批量导入」并上传 1000 条数据的 CSV 文件
Then 系统在 30 秒内完成导入，并显示成功导入的条数和失败条数`;

/** MCP content[] 的统一出口：所有工具都返回 JSON 文本 */
function jsonText(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export function createRequirementAnalyzerServer(): McpServer {
  const server = new McpServer({
    name: REQUIREMENT_ANALYZER_NAME,
    version: REQUIREMENT_ANALYZER_VERSION,
  });

  server.tool(
    'analyze_completeness',
    '分析需求描述的完整性，检查是否缺少关键维度（用户角色、功能描述、验收标准、优先级、非功能需求、边界条件）。' +
      '输入：需求描述文本。输出：完整性评分、已覆盖维度、缺失维度与补充建议。' +
      '不适用于：只需要估算工期而不用检查描述完整性的场景（此时用 estimate_complexity）。',
    { requirementText: z.string().describe('需求描述文本') },
    async ({ requirementText }) => jsonText(analyzeCompleteness(requirementText)),
  );

  server.tool(
    'estimate_complexity',
    '估算需求的技术复杂度，返回 T-shirt size（S/M/L/XL）、预计工期与复杂度因子。' +
      '输入：需求描述文本，可选技术栈。输出：size、estimatedDays、complexityScore、factors。' +
      '不适用于：非技术类问题或纯粹的文案修改评估。',
    {
      requirementText: z.string().describe('需求描述文本'),
      techStack: z.string().optional().describe('技术栈（可选，用于更精确的估算）'),
    },
    async ({ requirementText, techStack }) =>
      jsonText(estimateComplexity(requirementText, techStack)),
  );

  server.tool(
    'check_conflicts',
    '检查新需求是否与现有需求存在功能重叠。基于关键词重合度判断，共同关键词达到 3 个即标记为潜在冲突。' +
      '输入：新需求描述 + 现有需求列表（id/title/description）。输出：冲突列表与处理建议。',
    {
      newRequirement: z.string().describe('新的需求描述'),
      existingRequirements: z
        .array(
          z.object({
            id: z.string().describe('需求唯一标识'),
            title: z.string().describe('需求标题'),
            description: z.string().describe('需求描述正文'),
          }),
        )
        .describe('现有需求列表'),
    },
    async ({ newRequirement, existingRequirements }) =>
      jsonText(checkConflicts(newRequirement, existingRequirements)),
  );

  server.tool(
    'generate_user_stories',
    '从需求描述生成标准格式的用户故事（User Story），包含验收标准与优先级。' +
      '输入：需求描述文本，可选最多生成条数（默认 3）。输出：stories 数组。',
    {
      requirementText: z.string().describe('需求描述文本'),
      maxStories: z.number().optional().describe('最多生成几个用户故事，默认 3'),
    },
    async ({ requirementText, maxStories = 3 }) =>
      jsonText(generateUserStories(requirementText, maxStories)),
  );

  // 注意参数顺序是 (name, uri, cb)：先名字后 URI。
  // 写反了 resources/list 会把名字当 URI 返回，客户端就读不到资源了。
  server.resource(
    'PRD 模板',
    PRD_TEMPLATE_URI,
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: PRD_TEMPLATE },
      ],
    }),
  );

  server.resource(
    '验收标准规范',
    ACCEPTANCE_CRITERIA_URI,
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: ACCEPTANCE_CRITERIA_STANDARD,
        },
      ],
    }),
  );

  server.prompt(
    'analyze_requirement',
    '需求分析的标准 Prompt 模板，引导 LLM 从完整性、可行性、优先级、拆分建议、潜在风险五个维度分析一段需求',
    { requirementText: z.string().describe('需要分析的需求描述') },
    async ({ requirementText }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `请对以下需求进行全面分析：

【需求描述】
${requirementText}

请从以下维度分析：
1. 完整性：是否缺少用户角色、功能边界、验收标准、非功能需求？
2. 可行性：技术复杂度如何？有哪些技术风险？
3. 优先级建议：基于业务价值和技术成本给出 P0/P1/P2 建议
4. 拆分建议：如果需求过大，建议如何拆分为可独立交付的子需求？
5. 潜在风险：时间风险、技术风险、依赖风险`,
          },
        },
      ],
    }),
  );

  return server;
}
