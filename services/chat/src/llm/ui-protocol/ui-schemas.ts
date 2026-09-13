import { z } from 'zod';

/**
 * 纯文本 / Markdown 组件 Schema
 */
export const textComponentSchema = z
  .object({
    type: z.literal('text').describe('组件类型：纯文本或 Markdown'),
    content: z.string().describe('Markdown 格式或纯文本内容'),
  })
  .describe('文本组件');

/**
 * 选项条目 Schema (支持 id 与 value)
 */
export const selectionOptionSchema = z.object({
  id: z.string().optional().describe('选项唯一标识 Key'),
  value: z.string().describe('选项实际值'),
  label: z.string().describe('选项展示文本'),
  description: z.string().optional().describe('选项详细解释或副标题'),
  icon: z.string().optional().describe('图标标识'),
  disabled: z.boolean().optional().describe('是否置灰禁用'),
});

/**
 * 单选 / 多选卡片组件 Schema
 */
export const selectionComponentSchema = z
  .object({
    type: z.literal('selection').describe('组件类型：选项卡片'),
    title: z.string().describe('卡片标题（例如：请选择需求类型）'),
    description: z.string().optional().describe('补充提示文案'),
    mode: z.enum(['single', 'multiple']).optional().describe('单选或多选模式'),
    allowMultiple: z.boolean().optional().describe('是否允许多选'),
    options: z.array(selectionOptionSchema).describe('候选项列表'),
    actionKey: z.string().optional().describe('回传动作标识 Key'),
  })
  .describe('选择卡片组件');

/**
 * 表单字段类型枚举 Schema
 */
export const formFieldTypeSchema = z.enum([
  'input',
  'select',
  'textarea',
  'date',
  'number',
]);

/**
 * 表单下拉选项 Schema
 */
export const formSelectOptionSchema = z.object({
  label: z.string().describe('展示标签'),
  value: z.string().describe('实际值'),
});

/**
 * 动态表单字段 Schema
 */
export const formFieldSchema = z.object({
  name: z.string().describe('表单字段唯一名'),
  label: z.string().describe('字段标签'),
  type: formFieldTypeSchema.describe('字段录入类型'),
  placeholder: z.string().optional().describe('输入占位符'),
  required: z.boolean().optional().describe('是否必填'),
  defaultValue: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe('默认值'),
  options: z.array(formSelectOptionSchema).optional().describe('下拉可选项'),
});

/**
 * 动态表单组件 Schema
 */
export const formComponentSchema = z
  .object({
    type: z.literal('form').describe('组件类型：动态表单'),
    title: z.string().describe('表单标题'),
    description: z.string().optional().describe('表单填写指南'),
    submitText: z.string().optional().describe('提交按钮文字'),
    submitLabel: z.string().optional().describe('提交按钮文案标签'),
    actionKey: z.string().optional().describe('表单提交动作 Key'),
    fields: z.array(formFieldSchema).describe('表单字段集合'),
  })
  .describe('动态表单组件');

/**
 * 确认对话框组件 Schema
 */
export const confirmationComponentSchema = z
  .object({
    type: z.literal('confirmation').describe('组件类型：确认对话框'),
    title: z.string().describe('确认框标题（例如：确认提交需求分析）'),
    summary: z.string().describe('操作摘要与影响说明'),
    warning: z.string().optional().describe('操作风险警告说明'),
    details: z.record(z.string(), z.any()).optional().describe('关键信息键值对'),
    confirmText: z.string().optional().describe('确认按钮文案'),
    cancelText: z.string().optional().describe('取消按钮文案'),
    actionKey: z.string().optional().describe('回传确认标识 Key'),
  })
  .describe('确认对话框组件');

/**
 * 卡片键值条目 Schema
 */
export const cardFieldSchema = z.object({
  label: z.string().describe('条目标签'),
  value: z.string().describe('条目值'),
});

/**
 * 操作按钮 Schema (支持 id 与 actionKey)
 */
export const actionButtonSchema = z.object({
  id: z.string().optional().describe('按钮唯一标识 Key'),
  label: z.string().describe('按钮名称'),
  actionKey: z.string().optional().describe('动作唯一标识 Key'),
  payload: z.record(z.string(), z.any()).optional().describe('附加负载数据'),
  variant: z
    .enum(['primary', 'secondary', 'danger'])
    .optional()
    .describe('样式变体'),
});

/**
 * 信息展示卡片组件 Schema
 */
export const cardComponentSchema = z
  .object({
    type: z.literal('card').describe('组件类型：信息展示卡片'),
    title: z.string().describe('卡片主标题（例如：需求详情 REQ-20240315-001）'),
    subtitle: z.string().optional().describe('副标题'),
    status: z.string().optional().describe('状态标签（例如：进行中、已归档）'),
    fields: z.array(cardFieldSchema).describe('结构化展示条目列表'),
    actions: z.array(actionButtonSchema).optional().describe('快捷操作按钮组'),
    footer: z.string().optional().describe('底部备注'),
  })
  .describe('信息展示卡片组件');

/**
 * 流程步骤条目 Schema
 */
export const stepItemSchema = z.object({
  title: z.string().describe('步骤名称'),
  description: z.string().optional().describe('步骤补充说明'),
  status: z
    .enum(['wait', 'process', 'finish', 'error'])
    .optional()
    .describe('步骤所处状态'),
});

/**
 * 步骤进度条组件 Schema
 */
export const stepsComponentSchema = z
  .object({
    type: z.literal('steps').describe('组件类型：步骤进度条'),
    title: z.string().optional().describe('流程总览标题'),
    currentStep: z.number().int().describe('当前处于第几步（从 0 开始）'),
    items: z.array(stepItemSchema).describe('步骤列表'),
    steps: z.array(stepItemSchema).optional().describe('别名 steps 列表'),
  })
  .describe('步骤进度条组件');

/**
 * 表格列配置 Schema
 */
export const tableColumnSchema = z.object({
  key: z.string().describe('数据键'),
  title: z.string().describe('列标题'),
  width: z.union([z.string(), z.number()]).optional().describe('列宽'),
});

/**
 * 数据表格组件 Schema
 */
export const tableComponentSchema = z
  .object({
    type: z.literal('table').describe('组件类型：数据表格'),
    title: z.string().optional().describe('表格标题'),
    columns: z.array(tableColumnSchema).describe('表格列配置'),
    rows: z.array(z.record(z.string(), z.any())).describe('数据行集合'),
    selectable: z.boolean().optional().describe('是否支持行选择'),
  })
  .describe('数据表格组件');

/**
 * 操作按钮组组件 Schema
 */
export const actionButtonsComponentSchema = z
  .object({
    type: z.literal('action_buttons').describe('组件类型：操作按钮组'),
    title: z.string().optional().describe('提示说明'),
    layout: z.enum(['horizontal', 'vertical']).optional().describe('布局方向'),
    buttons: z.array(actionButtonSchema).describe('按钮列表'),
  })
  .describe('操作按钮组组件');

/**
 * 任务多步骤执行流水线进度条卡片 Schema (图 1 风格)
 */
export const progressComponentSchema = z
  .object({
    type: z.literal('progress').describe('组件类型：任务执行进度卡片'),
    title: z.string().describe('任务当前阶段标题（如：需求提取、架构评估）'),
    subtitle: z.string().optional().describe('进度说明（如：正在处理第 1 步，共 5 步）'),
    currentStep: z.number().int().describe('当前处于第几步'),
    totalSteps: z.number().int().describe('总步数'),
    percentage: z.number().describe('百分比数值（0~100）'),
    status: z.enum(['processing', 'success', 'error']).optional().describe('执行状态'),
    actionKey: z.string().optional().describe('动作标识'),
  })
  .describe('任务多步骤执行流水线进度条组件');

/**
 * 使用 z.discriminatedUnion 基于 type 做精确匹配的统一 UI 响应组件 Schema
 */
export const uiResponseSchema = z.discriminatedUnion('type', [
  textComponentSchema,
  selectionComponentSchema,
  formComponentSchema,
  confirmationComponentSchema,
  cardComponentSchema,
  stepsComponentSchema,
  tableComponentSchema,
  actionButtonsComponentSchema,
  progressComponentSchema,
]);

/**
 * 会话流转状态上下文 Schema
 */
export const uiResponseContextSchema = z.object({
  sessionStage: z.string().optional().describe('当前流程阶段'),
  collectedData: z.record(z.string(), z.any()).optional().describe('已收集的数据'),
});

/**
 * 用户 UI 交互回传数据 Schema (融合 componentType 与传统交互)
 */
export const uiActionSchema = z
  .object({
    componentType: z
      .enum([
        'text',
        'selection',
        'form',
        'confirmation',
        'card',
        'steps',
        'table',
        'action_buttons',
        'progress',
      ])
      .optional()
      .describe('触发操作的组件类型'),
    type: z
      .enum(['selection', 'form_submit', 'confirmation', 'button_click'])
      .optional()
      .describe('操作交互类型'),
    actionKey: z.string().optional().describe('动作业务标识 Key'),
    payload: z.any().optional().describe('操作携带的数据'),
  })
  .refine((data) => Boolean(data.componentType || data.type), {
    message: '必须提供有效的 componentType 或 type 以标识操作意图',
  });

/**
 * AI 结构化输出完整 Schema（通过 model.withStructuredOutput 约束）
 */
export const aiUIResponseSchema = z
  .object({
    message: z
      .string()
      .describe('对用户的自然语言回复或操作引导（支持 Markdown）'),
    components: z
      .array(uiResponseSchema)
      .describe('前端需要渲染的 UI 组件列表'),
    context: uiResponseContextSchema.optional().describe('流程状态上下文快照'),
  })
  .describe('AI 结构化 UI 响应数据结构');
