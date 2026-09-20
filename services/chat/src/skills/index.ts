/**
 * src/skills/index.ts — 第十三章 Skills 模块出口
 */
export type {
  SkillFrontmatter,
  SkillMetadata,
  SkillDefinition,
  LoadedSkill,
  SkillToolValidation,
  SkillValidationReport,
} from './skill-types.js';
export {
  SkillRegistry,
  type SkillRegistryOptions,
} from './skill-registry.js';
export {
  parseSkillFrontmatter,
  SAFE_SKILL_NAME_RE,
  MAX_DESCRIPTION_LENGTH,
  type FrontmatterParseResult,
} from './skill-frontmatter.js';
export {
  createSkillTools,
  SKILL_LOCAL_TOOL_NAMES,
  analyzeRequirementCompleteness,
  estimateRequirementComplexity,
  searchCompetitors,
  searchBestPractices,
  type CompletenessResult,
  type ComplexityResult,
  type CompetitorResult,
  type BestPracticeResult,
} from './skill-tools.js';
export {
  createLoadSkillTool,
  LOAD_SKILL_TOOL_NAME,
  type LoadSkillToolOptions,
} from './load-skill.tool.js';
export {
  SkillTraceCollector,
  summarizeSkillTraces,
  buildSkillLoadTrace,
  type SkillLoadTrace,
  type SkillLoadStatus,
  type SkillTraceContext,
  type SkillTraceSummary,
} from './skill-trace.js';
export {
  createSkillRuntime,
  getSharedSkillRuntime,
  resetSharedSkillRuntime,
  buildSkillIndexPrompt,
  buildSkillToolSet,
  resolveSkillsDir,
  type SkillRuntime,
  type SkillRuntimeOptions,
} from './skills-runtime.js';
