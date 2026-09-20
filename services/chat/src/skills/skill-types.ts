/**
 * src/skills/skill-types.ts
 *
 * 第十三章 13.3 — Agent Skills 规范在本项目里的类型落地
 *
 * 一个 Skill = 一个目录 + SKILL.md（YAML frontmatter + Markdown 正文）。
 * frontmatter 只保留规范要求的四个字段：name / description / allowed-tools / metadata。
 * 运行时扩展字段（脚本路径、质量校验等）一律不放进 frontmatter —— 规范把
 * allowed-tools 定义成字符串列表就是为了挡掉"把运行时配置写进资产"这个反模式。
 */

/** SKILL.md 的 frontmatter（解析后的形态） */
export interface SkillFrontmatter {
  name: string;
  description: string;
  allowedTools: string[];
  metadata?: SkillMetadata;
}

export interface SkillMetadata {
  author?: string;
  version?: string;
}

/**
 * 注册表里的 Skill 条目（L1：只有 name + description 进 system prompt）
 *
 * 注意 description 是规范里唯一负责"何时使用"的字段 ——
 * 规范不设 tags，因为最终是 LLM 读 description 做匹配。
 */
export interface SkillDefinition {
  name: string;
  description: string;
  allowedTools: string[];
  version: string;
  author?: string;
  /** Skill 目录绝对路径 */
  dirPath: string;
  /** SKILL.md 绝对路径 */
  filePath: string;
}

/** L2：load_skill 实际返回的内容 */
export interface LoadedSkill {
  definition: SkillDefinition;
  /** 去掉 frontmatter 的正文，比 raw 紧凑，推荐回给模型 */
  body: string;
  /** 完整原文（含 frontmatter） */
  raw: string;
  /** 正文字符数，用于 trace 观察"某个 Skill 是不是太长了" */
  bodyLength: number;
  /** 是否被 maxContentChars 截断过 */
  truncated?: boolean;
}

/** 13.10.2 启动期工具校验报告：Skill 声明的工具是否真的存在于工具栈里 */
export interface SkillToolValidation {
  skillName: string;
  /** 声明了但工具栈里没有的工具 —— 工具名是公共契约，这里红说明改名了或没注册 */
  missing: string[];
  /** 声明且存在的工具 */
  resolved: string[];
}

export interface SkillValidationReport {
  skills: SkillToolValidation[];
  /** 是否所有 Skill 的必选工具都已就位 */
  ok: boolean;
  missingCount: number;
}
