/**
 * services/chat/src/security/data-flow-guard.ts
 *
 * 数据流守卫（第十八章 18.15）
 *
 * 传统权限控制管「谁能做什么」，但管不了「数据从哪里来、流向哪里」。
 * 提示注入的核心手法就是：诱导 Agent 先从敏感源读数据，再发到外部。
 * 单看「读文件」和「发请求」都是合法操作，但组合起来就是数据外泄。
 *
 * 本模块提供：
 *   1. DataClassifier   —— 对数据内容做敏感度分类（PII、密钥、内网地址…）
 *   2. FlowRule         —— 定义「什么级别的数据不能流向哪些目标」
 *   3. DataFlowGuard    —— 在**发送/写入之前**检查数据流合规性
 *   4. DataLineageTracker —— 血缘追踪：即使内容被摘要改写，来源敏感度仍然适用
 *
 * 关键观点：Agent 可以阅读不可信内容，但不能服从不可信内容；
 *          Agent 可以读取敏感数据，但不能把敏感数据发到不可信目标。
 */

import { createHash } from 'node:crypto';

export type DataSensitivity = 'public' | 'internal' | 'confidential' | 'secret';

export type DataSource = 'user_input' | 'file' | 'database' | 'email' | 'web' | 'api';
export type DataTarget = 'user_output' | 'file' | 'database' | 'email' | 'web' | 'api' | 'log';

export interface ClassificationResult {
  sensitivity: DataSensitivity;
  matchedPatterns: string[];
}

/** 敏感度从低到高，顺序即严重性；比较大小靠下标 */
const SEVERITY_ORDER: DataSensitivity[] = ['public', 'internal', 'confidential', 'secret'];

export function sensitivityRank(s: DataSensitivity): number {
  const idx = SEVERITY_ORDER.indexOf(s);
  // 未知级别按最高敏感度处理（Fail Closed）
  return idx === -1 ? SEVERITY_ORDER.length - 1 : idx;
}

// ─────────────────────── DataClassifier ───────────────────────

export interface ClassificationRule {
  id: string;
  sensitivity: DataSensitivity;
  pattern: RegExp;
}

/**
 * 内置分类规则。
 *
 * ⚠️ 这里的正则**不带 `g` 标志**：带 `g` 的正则配合 `test()` 会残留
 * `lastIndex`，下一次从上次匹配的位置继续找，导致同一份内容前后两次
 * 判定结果不一致（参照实现靠每次手动 `lastIndex = 0` 兜底，很脆弱）。
 * 这里只需要"是否命中"，不需要全文扫描，去掉 `g` 就没有这个坑。
 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  // secret 级
  { id: 'api_key', sensitivity: 'secret', pattern: /(?:sk|pk|api[_-]?key)[_-][\w]{16,}/i },
  {
    id: 'private_key',
    sensitivity: 'secret',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i,
  },
  { id: 'aws_secret', sensitivity: 'secret', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/ },
  {
    id: 'password_field',
    sensitivity: 'secret',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
  },
  // 本项目特有：第十章方案 C 的加密密文（enc:v1:…）同样按 secret 处理
  { id: 'enc_cipher', sensitivity: 'secret', pattern: /enc:v1:[A-Za-z0-9+/=]{16,}/ },
  // confidential 级
  {
    id: 'email_address',
    sensitivity: 'confidential',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  },
  { id: 'phone_cn', sensitivity: 'confidential', pattern: /1[3-9]\d{9}/ },
  { id: 'id_card_cn', sensitivity: 'confidential', pattern: /\d{17}[\dXx]/ },
  {
    id: 'credit_card',
    sensitivity: 'confidential',
    pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/,
  },
  // internal 级
  {
    id: 'internal_url',
    sensitivity: 'internal',
    pattern: /https?:\/\/(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\S+/,
  },
  {
    id: 'db_connection',
    sensitivity: 'internal',
    pattern: /(?:postgres|mysql|mongodb):\/\/\S+/i,
  },
];

/** 数据内容敏感度分类器：扫描文本，返回最高敏感度 + 命中的规则 id */
export class DataClassifier {
  private readonly rules: ClassificationRule[];

  /** @param additionalRules 项目特有的补充规则（如内部系统代号、客户名单关键字） */
  constructor(additionalRules: ClassificationRule[] = []) {
    this.rules = [...CLASSIFICATION_RULES, ...additionalRules];
  }

  classify(content: string): ClassificationResult {
    const matched: string[] = [];
    let highest: DataSensitivity = 'public';

    for (const rule of this.rules) {
      if (!rule.pattern.test(content)) continue;
      matched.push(rule.id);
      if (sensitivityRank(rule.sensitivity) > sensitivityRank(highest)) {
        highest = rule.sensitivity;
      }
    }

    return { sensitivity: highest, matchedPatterns: matched };
  }
}

// ─────────────────────── FlowRule ───────────────────────

export interface FlowRule {
  /** 当数据敏感度 >= minSensitivity 时，禁止流向指定目标 */
  minSensitivity: DataSensitivity;
  /** 禁止的目标列表 */
  blockedTargets: DataTarget[];
}

const DEFAULT_FLOW_RULES: FlowRule[] = [
  // secret 级：不能流向任何外部目标，连日志和回给用户都不行
  { minSensitivity: 'secret', blockedTargets: ['web', 'email', 'log', 'user_output'] },
  // confidential 级：不能流向外部网络和日志
  { minSensitivity: 'confidential', blockedTargets: ['web', 'log'] },
  // internal 级：不能流向外部网络
  { minSensitivity: 'internal', blockedTargets: ['web'] },
];

// ─────────────────────── DataFlowGuard ───────────────────────

export class DataFlowViolation extends Error {
  constructor(
    public readonly sensitivity: DataSensitivity,
    public readonly target: DataTarget,
    public readonly matchedPatterns: string[],
  ) {
    super(
      `数据流违规：${sensitivity} 级数据不允许流向 ${target}（命中：${matchedPatterns.join(', ')}）`,
    );
    this.name = 'DataFlowViolation';
  }
}

/**
 * 数据流检查引擎。
 *
 * 用法：
 *   const guard = new DataFlowGuard();
 *   guard.checkBeforeSend('密钥 sk-abcdefghijklmnop', 'web');  // 抛 DataFlowViolation
 *   guard.checkBeforeSend('密钥 sk-abcdefghijklmnop', 'file'); // 通过（写本地文件允许）
 *
 * 时机很重要：检查必须发生在工具执行**之前**——等 Agent 已经把 secret
 * 发到 web 之后再检查，为时已晚。
 */
export class DataFlowGuard {
  private readonly classifier: DataClassifier;
  private readonly rules: FlowRule[];

  constructor(rules?: FlowRule[], classifier?: DataClassifier) {
    this.rules = rules ?? DEFAULT_FLOW_RULES;
    this.classifier = classifier ?? new DataClassifier();
  }

  /**
   * 纯规则判定：某敏感度的数据能否流向某目标。
   *
   * 单独抽出来是为了让血缘检查直接复用——血缘手里只有"来源敏感度"，
   * 没有内容文本，不该为了判定去伪造一段文本喂给分类器（见 checkLineage 注释）。
   */
  isSensitivityAllowed(sensitivity: DataSensitivity, target: DataTarget): boolean {
    const dataIdx = sensitivityRank(sensitivity);
    for (const rule of this.rules) {
      if (!rule.blockedTargets.includes(target)) continue;
      if (dataIdx >= sensitivityRank(rule.minSensitivity)) return false;
    }
    return true;
  }

  /** 在数据发送/写入前检查合规性；违规抛 DataFlowViolation */
  checkBeforeSend(content: string, target: DataTarget): ClassificationResult {
    const classification = this.classifier.classify(content);
    if (!this.isSensitivityAllowed(classification.sensitivity, target)) {
      throw new DataFlowViolation(
        classification.sensitivity,
        target,
        classification.matchedPatterns,
      );
    }
    return classification;
  }

  /** 静默检查：返回是否允许，不抛异常 */
  isAllowed(content: string, target: DataTarget): boolean {
    return this.isSensitivityAllowed(this.classifier.classify(content).sensitivity, target);
  }
}

// ─────────────────────── Data Lineage ───────────────────────

export interface LineageStep {
  agentId: string;
  action: 'read' | 'transform' | 'summarize' | 'forward';
  timestamp: string;
}

export interface DataLineageRecord {
  id: string;
  source: DataSource;
  sourceSensitivity: DataSensitivity;
  /** 内容 hash 而非原文：血缘链要能追溯，但不必存原文（隐私） */
  contentHash: string;
  steps: LineageStep[];
}

/**
 * 数据血缘追踪器。
 *
 * 跟踪数据从 source 到 sink 的完整路径，即使数据被摘要、改写、转述。
 *
 * 关键洞察：内容分类只看**当前文本**是否含敏感信息。
 * 但「读财务报表 → 摘要成不含敏感词的文字 → 发到公共频道」这条链，
 * 内容分类看摘要结果是 public，来源却是 confidential —— 血缘分类补上的正是这一环。
 */
export class DataLineageTracker {
  private readonly records = new Map<string, DataLineageRecord>();
  private readonly classifier: DataClassifier;
  private readonly guard: DataFlowGuard;
  private idCounter = 0;

  constructor(classifier?: DataClassifier) {
    this.classifier = classifier ?? new DataClassifier();
    this.guard = new DataFlowGuard(undefined, this.classifier);
  }

  /**
   * 记录一次数据读取，开启血缘链。
   * @returns lineage ID，后续步骤用它追踪
   */
  recordRead(source: DataSource, content: string, agentId: string): string {
    const id = `lineage-${++this.idCounter}`;
    const classification = this.classifier.classify(content);
    this.records.set(id, {
      id,
      source,
      sourceSensitivity: classification.sensitivity,
      contentHash: createHash('sha256').update(content).digest('hex').slice(0, 16),
      steps: [{ agentId, action: 'read', timestamp: new Date().toISOString() }],
    });
    return id;
  }

  /** 记录数据的转换/传递操作 */
  recordStep(lineageId: string, agentId: string, action: LineageStep['action']): void {
    const record = this.records.get(lineageId);
    if (!record) return;
    record.steps.push({ agentId, action, timestamp: new Date().toISOString() });
  }

  /**
   * 基于血缘检查数据是否可以流向目标。
   *
   * ⚠️ 参照实现这里是这么干的：按来源敏感度**伪造一段内容**
   * （secret 就伪造 'sk-fake_key_for_lineage_check'）再喂给分类器判定。
   * 这既绕又脆——一旦规则表改了，伪造文本可能不再命中任何规则，
   * 判定就静默失效。正确做法是直接比较敏感度（见 isSensitivityAllowed）。
   */
  checkLineage(lineageId: string, target: DataTarget): { allowed: boolean; reason?: string } {
    const record = this.records.get(lineageId);
    // 查不到血缘记录时放行：那是埋点缺失，不该由守卫随机决定拒绝
    if (!record) return { allowed: true };

    if (!this.guard.isSensitivityAllowed(record.sourceSensitivity, target)) {
      return {
        allowed: false,
        reason: `来源 ${record.source} 敏感度 ${record.sourceSensitivity}，不允许流向 ${target}`,
      };
    }
    return { allowed: true };
  }

  /** 完整血缘记录（含每一步是谁做的、做了什么） */
  getLineage(lineageId: string): DataLineageRecord | undefined {
    return this.records.get(lineageId);
  }

  get size(): number {
    return this.records.size;
  }
}
