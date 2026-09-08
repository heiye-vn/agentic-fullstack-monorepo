import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from '@autix/contracts';

// ============================================================
// 1. 约束合规性校验工具
// ============================================================

const CheckConstraintInputSchema = z.object({
  constraint: z
    .string()
    .describe('待校验的需求约束条件描述，例如：“必须绑定手机号”、“密码至少8位”'),
});

export type CheckConstraintInput = z.infer<typeof CheckConstraintInputSchema>;

export interface CheckConstraintResult {
  constraint: string;
  isValid: boolean;
  level: 'strict' | 'moderate' | 'weak';
  reason: string;
  suggestion: string;
}

/**
 * 校验需求约束有效性工具
 * 用于需求分析中评估约束条件的清晰度、可执行性与合规性
 */
export const checkConstraintValidityTool = tool(
  async (input: CheckConstraintInput): Promise<string> => {
    const text = input.constraint?.trim() ?? '';
    if (!text) {
      const emptyResult: CheckConstraintResult = {
        constraint: text,
        isValid: false,
        level: 'weak',
        reason: '约束条件内容为空，无法进行有效性评估',
        suggestion: '请提供明确的约束规则文本',
      };
      return JSON.stringify(emptyResult, null, 2);
    }

    // 模糊词识别
    const weakKeywords = ['尽量', '最好', '可能', '大概', '酌情', '适度', '力求', '视情况'];
    const matchedWeak = weakKeywords.filter((kw) => text.includes(kw));

    if (matchedWeak.length > 0) {
      const weakResult: CheckConstraintResult = {
        constraint: text,
        isValid: false,
        level: 'weak',
        reason: `约束表述包含模糊词汇【${matchedWeak.join('、')}】，缺乏可执行与验收指标`,
        suggestion: '建议改用绝对约束词（如“必须”、“严禁”、“不低于”），并给出明确的量化阈值',
      };
      return JSON.stringify(weakResult, null, 2);
    }

    // 强约束词识别
    const strictKeywords = [
      '必须',
      '至少',
      '不得',
      '不能',
      '严禁',
      '禁止',
      '限制',
      '强制',
      '需要',
      '不低于',
      '不超过',
      '唯一',
      '必填',
    ];
    const matchedStrict = strictKeywords.filter((kw) => text.includes(kw));

    if (matchedStrict.length > 0) {
      const strictResult: CheckConstraintResult = {
        constraint: text,
        isValid: true,
        level: 'strict',
        reason: `包含明确的强约束关键词【${matchedStrict.join('、')}】，判定规则清晰，具备可执行性与可验收性`,
        suggestion: '约束规范有效，可作为验收标准',
      };
      return JSON.stringify(strictResult, null, 2);
    }

    const moderateResult: CheckConstraintResult = {
      constraint: text,
      isValid: true,
      level: 'moderate',
      reason: '约束条件表述相对明确，但建议补充边界条件或异常处理分支',
      suggestion: '可进一步补充极端边界值或失败回退策略',
    };
    return JSON.stringify(moderateResult, null, 2);
  },
  {
    name: 'check_constraint_validity',
    description:
      '校验需求中的约束条件是否合规有效。分析约束是否包含明确的执行词（如必须、至少、严禁），排查模糊词，并给出有效性评估与优化建议',
    schema: CheckConstraintInputSchema,
  },
);

// ============================================================
// 2. 领域实体标准定义查询工具
// ============================================================

const LookupEntityInputSchema = z.object({
  entity: z
    .string()
    .describe('需要查询标准业务定义的实体名称，例如：“用户”、“手机号”、“密码”等'),
});

export type LookupEntityInput = z.infer<typeof LookupEntityInputSchema>;

export interface LookupEntityResult {
  entity: string;
  found: boolean;
  definition: string;
  domain: string;
  attributes?: string[];
}

/** 领域实体标准字典库 */
const ENTITY_DICTIONARY: Record<
  string,
  { definition: string; domain: string; attributes: string[] }
> = {
  用户: {
    definition: '系统参与主体与账号持有者，具有唯一标识 UID 及安全凭证与个人资料。',
    domain: '账户与权限',
    attributes: ['uid', 'status', 'created_at'],
  },
  手机号: {
    definition:
      '用户的法定唯一通信标识，用于安全双因子认证 (2FA)、短信验证码及敏感操作身份核验。',
    domain: '安全与身份认证',
    attributes: ['country_code', 'phone_number', 'is_verified'],
  },
  密码: {
    definition:
      '用于用户身份鉴权与登录的核心凭证密钥，必须受密码安全强度策略限制（长度/复杂度/哈希加盐存储）。',
    domain: '安全凭证',
    attributes: ['salt', 'hash_algorithm', 'expired_at'],
  },
  验证码: {
    definition:
      '具有严格时效性（如5分钟）的临时数字/字母认证码，用于防重放、防刷及敏感操作确认。',
    domain: '安全凭证',
    attributes: ['code', 'expires_in', 'scene'],
  },
  订单: {
    definition:
      '业务交易契约凭单，记录买卖双方信息、商品快照、支付状态与履约生命周期。',
    domain: '交易中心',
    attributes: ['order_id', 'buyer_id', 'amount', 'status'],
  },
  商品: {
    definition: '可在系统中展示、售卖和履约的标的物单元 (SPU/SKU)。',
    domain: '商品中心',
    attributes: ['item_id', 'sku_id', 'price', 'stock'],
  },
};

/**
 * 领域实体标准定义查询工具
 * 用于需求分析中查询特定业务实体的统一领域定义与规范说明
 */
export const lookupEntityDefinitionTool = tool(
  async (input: LookupEntityInput): Promise<string> => {
    const rawEntity = input.entity?.trim() ?? '';
    if (!rawEntity) {
      const emptyResult: LookupEntityResult = {
        entity: rawEntity,
        found: false,
        definition: '实体名称为空，无法查询',
        domain: '未知',
      };
      return JSON.stringify(emptyResult, null, 2);
    }

    // 精确匹配与包含匹配
    let matchKey = Object.keys(ENTITY_DICTIONARY).find(
      (k) => k === rawEntity || rawEntity.includes(k) || k.includes(rawEntity),
    );

    if (matchKey && ENTITY_DICTIONARY[matchKey]) {
      const info = ENTITY_DICTIONARY[matchKey];
      const result: LookupEntityResult = {
        entity: rawEntity,
        found: true,
        definition: info.definition,
        domain: info.domain,
        attributes: info.attributes,
      };
      return JSON.stringify(result, null, 2);
    }

    const notFoundResult: LookupEntityResult = {
      entity: rawEntity,
      found: false,
      definition: `实体【${rawEntity}】属于业务扩展实体，建议在数据字典与领域建模中补充字段定义。`,
      domain: '业务扩展',
    };
    return JSON.stringify(notFoundResult, null, 2);
  },
  {
    name: 'lookup_entity_definition',
    description:
      '查询业务实体的领域标准定义与属性规范，例如查询“用户”、“手机号”、“密码”、“订单”等实体的官方解释与归属领域',
    schema: LookupEntityInputSchema,
  },
);

// ============================================================
// 工具集导出
// ============================================================

export const basicTools = [checkConstraintValidityTool, lookupEntityDefinitionTool];

export const toolsByName: Record<string, StructuredToolInterface> = {
  [checkConstraintValidityTool.name]: checkConstraintValidityTool,
  [lookupEntityDefinitionTool.name]: lookupEntityDefinitionTool,
};
