/**
 * UI 响应协议核心类型定义
 * 贴合业务场景：需求分析系统流程
 * 融合 LCEL 规范与 TypeScript 强类型收窄设计
 */

// ==========================================
// 1. 各 UI 组件具体结构类型
// ==========================================

/**
 * 纯文本 / Markdown 响应组件
 */
export interface TextComponent {
  type: 'text';
  /** Markdown 格式或纯文本内容 */
  content: string;
}

/**
 * 选项条目定义 (兼容 id 与 value)
 */
export interface SelectionOption {
  /** 选项唯一标识 Key */
  id?: string;
  /** 选项实际值 */
  value: string;
  /** 选项展示文案 */
  label: string;
  /** 选项补充说明（例如需求类型解释） */
  description?: string;
  /** 可选图标标识 */
  icon?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 单选 / 多选卡片组件
 */
export interface SelectionComponent {
  type: 'selection';
  /** 卡片标题（例如：请选择需求类型） */
  title: string;
  /** 卡片副标题或提示描述 */
  description?: string;
  /** 选择模式：单选或多选 */
  mode?: 'single' | 'multiple';
  /** 是否允许多选（与 mode 单复选配置同步） */
  allowMultiple?: boolean;
  /** 可选项列表 */
  options: SelectionOption[];
  /** 操作标识 Key，用于回传时匹配处理逻辑 */
  actionKey?: string;
}

/**
 * 动态表单支持的字段输入类型
 */
export type FormFieldType = 'input' | 'select' | 'textarea' | 'date' | 'number';

/**
 * 表单下拉选项定义
 */
export interface FormSelectOption {
  label: string;
  value: string;
}

/**
 * 表单单字段定义
 */
export interface FormField {
  /** 字段唯一标识名 */
  name: string;
  /** 字段展示标签 */
  label: string;
  /** 输入控件类型 */
  type: FormFieldType;
  /** 占位符提示文案 */
  placeholder?: string;
  /** 是否必填 */
  required?: boolean;
  /** 默认初始值 */
  defaultValue?: string | number | boolean;
  /** 下拉框候选项（当 type 为 select 时生效） */
  options?: FormSelectOption[];
}

/**
 * 动态表单组件
 */
export interface FormComponent {
  type: 'form';
  /** 表单标题（例如：填写需求详细信息） */
  title: string;
  /** 表单使用指南或描述 */
  description?: string;
  /** 提交按钮文本 */
  submitText?: string;
  /** 提交按钮文案（与 submitText 别名兼容） */
  submitLabel?: string;
  /** 表单提交标识 Key */
  actionKey?: string;
  /** 动态表单字段列表 */
  fields: FormField[];
}

/**
 * 确认对话框组件
 */
export interface ConfirmationComponent {
  type: 'confirmation';
  /** 确认框标题（例如：确认提交需求分析） */
  title: string;
  /** 操作摘要内容 */
  summary: string;
  /** 警告提示信息 */
  warning?: string;
  /** 关键确认信息键值对列表（例如：需求编号、优先级、负责人） */
  details?: Record<string, any>;
  /** 确认按钮文案（默认：确认） */
  confirmText?: string;
  /** 取消按钮文案（默认：取消） */
  cancelText?: string;
  /** 确认动作标识 Key */
  actionKey?: string;
}

/**
 * 卡片键值对信息条目
 */
export interface CardField {
  label: string;
  value: string;
}

/**
 * 信息展示卡片组件（例如：需求详情卡片、订单详情等）
 */
export interface CardComponent {
  type: 'card';
  /** 卡片主标题（例如：需求详情 REQ-20240315-001） */
  title: string;
  /** 卡片副标题 */
  subtitle?: string;
  /** 状态标签（例如：进行中、待评审、已归档） */
  status?: string;
  /** 结构化展示条目 */
  fields: CardField[];
  /** 卡片快捷操作按钮列表 */
  actions?: ActionButton[];
  /** 底部备注或补充说明 */
  footer?: string;
}

/**
 * 流程步骤条目
 */
export interface StepItem {
  /** 步骤名称（例如：需求录入、智能抽取、架构评审、排期归档） */
  title: string;
  /** 步骤描述 */
  description?: string;
  /** 步骤状态 */
  status?: 'wait' | 'process' | 'finish' | 'error';
}

/**
 * 步骤进度条组件
 */
export interface StepsComponent {
  type: 'steps';
  /** 流程标题（例如：需求分析处理生命周期） */
  title?: string;
  /** 当前所处步骤索引（从 0 开始） */
  currentStep: number;
  /** 步骤节点列表 */
  items: StepItem[];
  /** 步骤列表别名兼容 */
  steps?: StepItem[];
}

/**
 * 数据表格列定义
 */
export interface TableColumn {
  /** 列字段 key */
  key: string;
  /** 列展示标题 */
  title: string;
  /** 列宽 */
  width?: string | number;
}

/**
 * 数据表格组件
 */
export interface TableComponent {
  type: 'table';
  /** 表格标题（例如：历史关联需求一览） */
  title?: string;
  /** 表格列结构定义 */
  columns: TableColumn[];
  /** 表格行数据记录 */
  rows: Record<string, any>[];
  /** 是否支持行勾选 */
  selectable?: boolean;
}

/**
 * 操作按钮定义
 */
export interface ActionButton {
  /** 按钮唯一标识 Key */
  id?: string;
  /** 按钮文案 */
  label: string;
  /** 触发动作标识 Key */
  actionKey?: string;
  /** 携带的动作负载参数 */
  payload?: Record<string, any>;
  /** 按钮视觉样式变体 */
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * 操作按钮组组件
 */
export interface ActionButtonsComponent {
  type: 'action_buttons';
  /** 操作组提示标题 */
  title?: string;
  /** 布局方式（水平/垂直） */
  layout?: 'horizontal' | 'vertical';
  /** 按钮列表 */
  buttons: ActionButton[];
}

// ==========================================
// 2. 响应类型别名导出 (*Response 与 *Component 对齐)
// ==========================================

export type TextResponse = TextComponent;
export type SelectionResponse = SelectionComponent;
export type FormResponse = FormComponent;
export type ConfirmationResponse = ConfirmationComponent;
export type CardResponse = CardComponent;
export type StepsResponse = StepsComponent;
export type TableResponse = TableComponent;
export type ActionButtonsResponse = ActionButtonsComponent;

/**
 * 任务多步骤执行流水线进度条卡片（图 1 风格）
 */
export interface ProgressComponent {
  type: 'progress';
  /** 任务主阶段名称（例如：需求提取、实体解析、架构评估） */
  title: string;
  /** 当前阶段详细说明（例如：正在处理第 1 步，共 5 步） */
  subtitle?: string;
  /** 当前所处步骤（1-based） */
  currentStep: number;
  /** 总步数（例如：5） */
  totalSteps: number;
  /** 进度百分比数值（0~100） */
  percentage: number;
  /** 当前状态 */
  status?: 'processing' | 'success' | 'error';
  /** 动作标识 Key */
  actionKey?: string;
}

export type ProgressResponse = ProgressComponent;

/**
 * 所有前端支持的 UI 组件联合类型
 */
export type UIComponent =
  | TextComponent
  | SelectionComponent
  | FormComponent
  | ConfirmationComponent
  | CardComponent
  | StepsComponent
  | TableComponent
  | ActionButtonsComponent
  | ProgressComponent;

/**
 * UI 响应组件定义（别名 UIResponse）
 */
export type UIResponse = UIComponent;

// ==========================================
// 3. 用户交互操作回传定义 (判别联合 Discriminated Union)
// ==========================================

/**
 * 选择操作负载
 */
export interface SelectActionPayload {
  type: 'select';
  /** 选中的项标识或值 */
  selectedId?: string | string[];
  selectedValue?: string | string[];
}

/**
 * 表单提交操作负载
 */
export interface SubmitActionPayload {
  type: 'submit';
  /** 用户填写的表单字段字典 */
  formData: Record<string, unknown>;
}

/**
 * 确认框操作负载
 */
export interface ConfirmActionPayload {
  type: 'confirm';
  /** 用户点击确认还是取消 */
  confirmed: boolean;
}

/**
 * 按钮点击操作负载
 */
export interface ClickActionPayload {
  type: 'click';
  /** 触发动作的按钮标识 */
  actionId?: string;
  actionKey?: string;
}

/**
 * 表格行选择操作负载
 */
export interface RowSelectActionPayload {
  type: 'row_select';
  /** 选中的行索引 */
  rowIndex: number;
  /** 行记录数据 */
  rowData?: Record<string, unknown>;
}

/**
 * 强类型收窄操作载荷联合
 */
export type UIActionPayload =
  | SelectActionPayload
  | SubmitActionPayload
  | ConfirmActionPayload
  | ClickActionPayload
  | RowSelectActionPayload;

/**
 * 用户在 UI 上的操作回传数据
 * 包含严格的判别联合与业务动作标识
 */
export interface UIAction {
  /** 触发该操作的组件类型 */
  componentType?: UIResponse['type'];
  /** 动作业务标识 Key（如：select_requirement_type、submit_req_form） */
  actionKey?: string;
  /** 兼容传统操作类型字段 */
  type?: 'selection' | 'form_submit' | 'confirmation' | 'button_click' | string;
  /** 操作携带的数据负载（支持严格的 payload 辨别联合，也兼容宽松字典） */
  payload?: UIActionPayload | any;
}

// ==========================================
// 4. AI 结构化响应协议 (含状态上下文)
// ==========================================

/**
 * 会话流转上下文元数据
 */
export interface UIResponseContext {
  /** 当前需求流程所处阶段（如：fill_form、confirming、completed） */
  sessionStage?: string;
  /** 当前已提取或收集的结构化数据快照 */
  collectedData?: Record<string, unknown>;
}

/**
 * AI UI 结构化响应协议（Structured Output 返回标准）
 */
export interface AIUIResponse {
  /** 自然语言文本回复或引导语（支持 Markdown 语法） */
  message: string;
  /** 根据上下文需要同时渲染的 UI 组件列表 */
  components: UIResponse[];
  /** 会话流程状态上下文快照（前端可持久化并在下次请求时带回） */
  context?: UIResponseContext;
}
