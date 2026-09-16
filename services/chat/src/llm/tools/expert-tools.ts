import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from '@autix/contracts';

// ============================================================
// 1. 功能专家工具：读取已有功能模块规范 (read_feature_spec)
// ============================================================

const ReadFeatureSpecInputSchema = z.object({
  featureName: z
    .string()
    .describe('功能或模块名称，例如：“用户认证中心”、“文件上传模块”、“报表导出服务”'),
});

export type ReadFeatureSpecInput = z.infer<typeof ReadFeatureSpecInputSchema>;

export const readFeatureSpecTool = tool(
  async (input: ReadFeatureSpecInput): Promise<string> => {
    const feature = (input.featureName ?? '').trim();
    return JSON.stringify({
      success: true,
      featureName: feature,
      moduleSpec: {
        architectureTier: 'Core Business Service',
        standardProtocol: 'REST / GraphQL / SSE',
        dataConsistency: 'Transaction-backed Strong Consistency',
        keyConstraints: [
          '所有对外接口均须接入统一网关拦截器',
          '严格实施基于 RBAC 的细粒度权限校验',
          '大批量数据操作强制采用异步分片队列处理',
        ],
        documentationUrl: `https://wiki.internal/specs/${encodeURIComponent(feature)}`,
      },
    });
  },
  {
    name: 'read_feature_spec',
    description:
      '读取已有功能模块的业务规范与架构设计文档，用于评估新功能与现有系统规范的兼容性',
    schema: ReadFeatureSpecInputSchema,
  },
);

// ============================================================
// 2. 性能专家工具：加载服务性能基线 (load_perf_baseline)
// ============================================================

const LoadPerfBaselineInputSchema = z.object({
  serviceName: z
    .string()
    .describe('待评估的服务或模块名称，例如：“chat-service”、“export-worker”、“gateway”'),
});

export type LoadPerfBaselineInput = z.infer<typeof LoadPerfBaselineInputSchema>;

export const loadPerfBaselineTool = tool(
  async (input: LoadPerfBaselineInput): Promise<string> => {
    const service = (input.serviceName ?? 'chat-service').trim();
    return JSON.stringify({
      success: true,
      serviceName: service,
      baselineMetrics: {
        avgQps: 350,
        peakQps: 1200,
        p50LatencyMs: 45,
        p95LatencyMs: 120,
        p99LatencyMs: 380,
        avgCpuUsagePercent: 32,
        avgMemoryMb: 512,
        maxBatchRowsAllowed: 5000,
        concurrencyLimit: 200,
      },
      systemCapacityNotes:
        '在并发超过 800 QPS 或单次文件处理超过 5,000 行时，需启动异步分流与背压保护。',
    });
  },
  {
    name: 'load_perf_baseline',
    description:
      '获取相关服务的当前线上性能基线指标（如 QPS、P95/P99 延迟、内存消耗及批处理上限）',
    schema: LoadPerfBaselineInputSchema,
  },
);

// ============================================================
// 3. 性能专家工具：性能预算评估 (check_perf_budget)
// ============================================================

const CheckPerfBudgetInputSchema = z.object({
  estimatedQps: z.number().optional().describe('预估业务请求 QPS'),
  targetLatencyMs: z.number().optional().describe('目标响应时间预算（毫秒）'),
  dataVolumeRows: z.number().optional().describe('单次处理数据量级（行数或记录数）'),
  scenarioDescription: z.string().describe('性能场景描述（如批量导入、高频轮询）'),
});

export type CheckPerfBudgetInput = z.infer<typeof CheckPerfBudgetInputSchema>;

export const checkPerfBudgetTool = tool(
  async (input: CheckPerfBudgetInput): Promise<string> => {
    const volume = input.dataVolumeRows ?? 0;
    const qps = input.estimatedQps ?? 0;
    const overBudget = volume > 5000 || qps > 1000;

    return JSON.stringify({
      success: true,
      scenario: input.scenarioDescription,
      isWithinBudget: !overBudget,
      evaluation: {
        budgetLimitRows: 5000,
        budgetLimitQps: 1000,
        currentRequestRows: volume,
        currentRequestQps: qps,
        riskLevel: overBudget ? 'HIGH' : 'LOW',
        bottleneckRisk: overBudget
          ? '数据吞吐超限，同步阻塞会导致 Node.js 事件循环延迟，引发整体请求排队超时'
          : '指标在正常性能预算范围内',
        architecturalAdvice: overBudget
          ? '建议采用异步任务队列（如 BullMQ / Kafka）解耦，提供任务 ID 轮询或 SSE 进度推送'
          : '可继续采用当前微服务同步处理模式',
      },
    });
  },
  {
    name: 'check_perf_budget',
    description:
      '评估新需求预估的访问负载与数据规模是否超出系统性能预算上限，并给出架构选型建议',
    schema: CheckPerfBudgetInputSchema,
  },
);

// ============================================================
// 4. 安全专家工具：安全策略校验 (check_security_policy)
// ============================================================

const CheckSecurityPolicyInputSchema = z.object({
  actionType: z
    .string()
    .describe('操作类型或业务领域，例如：“文件上传”、“数据导出”、“第三方接口回调”'),
  dataSensitivity: z
    .enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'])
    .optional()
    .describe('数据安全密级'),
});

export type CheckSecurityPolicyInput = z.infer<
  typeof CheckSecurityPolicyInputSchema
>;

export const checkSecurityPolicyTool = tool(
  async (input: CheckSecurityPolicyInput): Promise<string> => {
    const action = input.actionType.toLowerCase();
    const policies: string[] = [];

    if (action.includes('文件') || action.includes('上传') || action.includes('导入')) {
      policies.push('SEC-FILE-001: 必须进行服务端扩展名白名单校验与真实 MIME 类型魔数嗅探');
      policies.push('SEC-FILE-002: 上传文件须经过防病毒扫描，严禁直接在 Web 根目录下落盘并执行');
    }
    if (action.includes('导出') || action.includes('批量') || action.includes('下载')) {
      policies.push('SEC-EXP-001: 包含用户敏感信息（手机、身份证）时必须字段级脱敏显示');
      policies.push('SEC-EXP-002: 单次批量导出必须记录完整的审计日志（操作人、时间、范围、IP）');
    }
    if (action.includes('auth') || action.includes('认证') || action.includes('登录')) {
      policies.push('SEC-AUTH-001: 密码传输须采用 HTTPS 且后端不可逆盐值哈希加密');
      policies.push('SEC-AUTH-002: 防止爆破攻击，需配备 IP + 账号双重失败速率限制防护');
    }

    return JSON.stringify({
      success: true,
      actionType: input.actionType,
      triggeredPolicies:
        policies.length > 0
          ? policies
          : ['SEC-GEN-001: 遵循最小特权原则与标准参数化校验，防范 SQL 注入与 XSS'],
      mandatoryRequirements: [
        '开启审计追踪日志（Audit Trail）',
        '接口参数实施严格的 Zod Schema 校验',
      ],
    });
  },
  {
    name: 'check_security_policy',
    description:
      '检查指定操作是否触发组织信息安全策略与红线规范（如文件安全、数据脱敏、传输加密）',
    schema: CheckSecurityPolicyInputSchema,
  },
);

// ============================================================
// 5. 安全专家工具：认证鉴权场景清单 (list_auth_scenarios)
// ============================================================

const ListAuthScenariosInputSchema = z.object({
  domain: z
    .string()
    .optional()
    .describe('认证鉴权领域，如：“web”、“mobile”、“open-api”、“admin”'),
});

export type ListAuthScenariosInput = z.infer<
  typeof ListAuthScenariosInputSchema
>;

export const listAuthScenariosTool = tool(
  async (input: ListAuthScenariosInput): Promise<string> => {
    return JSON.stringify({
      success: true,
      domain: input.domain ?? 'web',
      authArchitectures: {
        tokenModel: 'JWT (Access Token 2h + Refresh Token 7d)',
        storage: 'HttpOnly SameSite Secure Cookie 或 Authorization Bearer Header',
        rbacMatrix: {
          superAdmin: '全站所有特权，具备租户隔离穿透管理能力',
          tenantAdmin: '租户内部用户、角色、项目及导出任务管理',
          standardUser: '普通业务操作、个人数据查询与申请',
        },
        mfaPolicy: '对于涉及系统级配置变更或大额交易操作，必须二次校验动态验证码',
      },
    });
  },
  {
    name: 'list_auth_scenarios',
    description:
      '查询系统当前支持的身份认证与访问控制方案（如 JWT 规范、RBAC 角色权限模型、MFA 策略）',
    schema: ListAuthScenariosInputSchema,
  },
);

// ============================================================
// 6. 合规专家工具：合规要求矩阵检测 (check_compliance_matrix)
// ============================================================

const CheckComplianceMatrixInputSchema = z.object({
  businessDomain: z
    .string()
    .describe('业务场景与行业领域，例如：“跨国电商”、“金融支付”、“医疗健康”、“AI数据标注”'),
  dataTypes: z
    .array(z.string())
    .optional()
    .describe('涉及的数据类别，如：["个人信息", "银行卡号", "位置轨迹", "健康记录"]'),
});

export type CheckComplianceMatrixInput = z.infer<
  typeof CheckComplianceMatrixInputSchema
>;

export const checkComplianceMatrixTool = tool(
  async (input: CheckComplianceMatrixInput): Promise<string> => {
    return JSON.stringify({
      success: true,
      domain: input.businessDomain,
      applicableRegulations: [
        '中华人民共和国个人信息保护法 (PIPL)',
        '中华人民共和国网络安全法',
        '通用数据保护条例 (EU GDPR)',
      ],
      complianceRequirements: [
        '收集用户敏感个人信息必须具备单独同意（Separate Consent）机制',
        '用户有权查询、复制、更正及请求注销账户与删除个人数据',
        '必须向用户明确告知数据处理目的、方式和保留周期',
      ],
      industrySpecifics:
        '金融或支付相关场景须严格遵循 PCI-DSS 规范，不可明文留存银行卡 CVV/安全码。',
    });
  },
  {
    name: 'check_compliance_matrix',
    description:
      '检测需求涉及的法律法规矩阵与行业监管合规要求（如 PIPL、GDPR、数据安全等级保护）',
    schema: CheckComplianceMatrixInputSchema,
  },
);

// ============================================================
// 7. 合规专家工具：数据驻留与跨境策略 (check_data_residency)
// ============================================================

const CheckDataResidencyInputSchema = z.object({
  sourceRegion: z.string().describe('数据产生或用户所在区域，例如：“CN”、“EU”、“US”'),
  targetRegion: z.string().describe('数据存储或云服务所在区域，例如：“CN”、“SG”、“US”'),
});

export type CheckDataResidencyInput = z.infer<
  typeof CheckDataResidencyInputSchema
>;

export const checkDataResidencyTool = tool(
  async (input: CheckDataResidencyInput): Promise<string> => {
    const isCrossBorder = input.sourceRegion !== input.targetRegion;
    return JSON.stringify({
      success: true,
      crossBorderTransfer: isCrossBorder,
      policy: isCrossBorder
        ? {
            allowed: true,
            conditions: [
              '必须通过国家网信部门标准合同备案或安全评估',
              '需获得数据主体的明确单独同意',
              '跨境传输必须实施高强度端到端加密（TLS 1.3 + AES-256）',
            ],
            warning: '未经合规审查严禁直接向境外传输重要数据及规模化个人信息！',
          }
        : {
            allowed: true,
            conditions: ['数据保存在境内云节点，符合数据本地化合规基线。'],
          },
    });
  },
  {
    name: 'check_data_residency',
    description:
      '验证数据驻留地（Data Residency）与跨境传输（Cross-Border Transfer）合规性要求',
    schema: CheckDataResidencyInputSchema,
  },
);

// ============================================================
// 8. 合规专家工具：数据生命周期与保留期限 (check_retention_policy)
// ============================================================

const CheckRetentionPolicyInputSchema = z.object({
  dataCategory: z
    .string()
    .describe('数据资产类别，例如：“用户日志”、“交易流水”、“临时上传文件”'),
});

export type CheckRetentionPolicyInput = z.infer<
  typeof CheckRetentionPolicyInputSchema
>;

export const checkRetentionPolicyTool = tool(
  async (input: CheckRetentionPolicyInput): Promise<string> => {
    const category = input.dataCategory.toLowerCase();
    let retention = '180 天（依网络安全法留存）';
    let cleanupStrategy = '定时归档冷存并软删除';

    if (category.includes('临时') || category.includes('上传') || category.includes('import')) {
      retention = '7 天（处理完成后自动清理）';
      cleanupStrategy = '物理覆盖擦除并删除存储桶对象';
    } else if (category.includes('交易') || category.includes('支付') || category.includes('订单')) {
      retention = '不少于 3 年（依电子商务法及税务要求）';
      cleanupStrategy = '只读封存，禁止篡改';
    }

    return JSON.stringify({
      success: true,
      category: input.dataCategory,
      mandatoryRetentionPeriod: retention,
      destructionProtocol: cleanupStrategy,
      gdprRightToBeForgotten:
        '若用户发起注销或删除申请，非法律强制留存数据必须在 30 日内彻底匿名化。',
    });
  },
  {
    name: 'check_retention_policy',
    description:
      '确认业务数据资产的合法保留期限、归档策略与删除销毁规范（符合合规审计要求）',
    schema: CheckRetentionPolicyInputSchema,
  },
);

export const expertTools = [
  readFeatureSpecTool,
  loadPerfBaselineTool,
  checkPerfBudgetTool,
  checkSecurityPolicyTool,
  listAuthScenariosTool,
  checkComplianceMatrixTool,
  checkDataResidencyTool,
  checkRetentionPolicyTool,
];

export const expertToolsByName: Record<string, StructuredToolInterface> = {
  [readFeatureSpecTool.name]: readFeatureSpecTool,
  [loadPerfBaselineTool.name]: loadPerfBaselineTool,
  [checkPerfBudgetTool.name]: checkPerfBudgetTool,
  [checkSecurityPolicyTool.name]: checkSecurityPolicyTool,
  [listAuthScenariosTool.name]: listAuthScenariosTool,
  [checkComplianceMatrixTool.name]: checkComplianceMatrixTool,
  [checkDataResidencyTool.name]: checkDataResidencyTool,
  [checkRetentionPolicyTool.name]: checkRetentionPolicyTool,
};
