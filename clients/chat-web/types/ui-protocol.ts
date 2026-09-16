/**
 * AI UI 协议核心类型定义（与后端 ui-types.ts 保持同构）
 */

// ==========================================
// 1. 各 UI 组件具体结构类型
// ==========================================

export interface TextComponent {
  type: 'text';
  /** Markdown 格式或纯文本内容 */
  content: string;
}

export interface SelectionOption {
  id?: string;
  value: string;
  label: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
}

export interface SelectionComponent {
  type: 'selection';
  title: string;
  description?: string;
  mode?: 'single' | 'multiple';
  allowMultiple?: boolean;
  options: SelectionOption[];
  actionKey?: string;
}

export type FormFieldType = 'input' | 'select' | 'textarea' | 'date' | 'number';

export interface FormSelectOption {
  label: string;
  value: string;
}

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  options?: FormSelectOption[];
}

export interface FormComponent {
  type: 'form';
  title: string;
  description?: string;
  submitText?: string;
  submitLabel?: string;
  actionKey?: string;
  fields: FormField[];
}

export interface ConfirmationComponent {
  type: 'confirmation';
  title: string;
  summary: string;
  warning?: string;
  details?: Record<string, unknown>;
  confirmText?: string;
  cancelText?: string;
  actionKey?: string;
}

export interface CardField {
  label: string;
  value: string;
}

export interface ActionButton {
  id?: string;
  label: string;
  actionKey?: string;
  payload?: Record<string, unknown>;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface CardComponent {
  type: 'card';
  title: string;
  subtitle?: string;
  status?: string;
  fields: CardField[];
  actions?: ActionButton[];
  footer?: string;
}

export interface StepItem {
  title: string;
  label?: string;
  description?: string;
  status?: 'wait' | 'process' | 'finish' | 'error' | 'completed' | 'running';
  parallel?: boolean;
}

export interface StepsComponent {
  type: 'steps';
  title?: string;
  currentStep: number;
  totalSteps?: number;
  status?: string;
  items?: StepItem[];
  steps?: StepItem[];
}

export interface TableColumn {
  key: string;
  title: string;
  width?: string | number;
}

export interface TableComponent {
  type: 'table';
  title?: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  selectable?: boolean;
}

export interface ActionButtonsComponent {
  type: 'action_buttons';
  title?: string;
  layout?: 'horizontal' | 'vertical';
  buttons: ActionButton[];
}

export interface ProgressComponent {
  type: 'progress';
  title: string;
  subtitle?: string;
  currentStep: number;
  totalSteps: number;
  percentage: number;
  status?: 'processing' | 'success' | 'error';
  actionKey?: string;
  parallel?: boolean;
}

// ==========================================
// 2. 联合类型
// ==========================================

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

export type UIResponse = UIComponent;

// ==========================================
// 3. 用户交互操作回传定义
// ==========================================

export interface SelectActionPayload {
  type: 'select';
  selectedId?: string | string[];
  selectedValue?: string | string[];
}

export interface SubmitActionPayload {
  type: 'submit';
  formData: Record<string, unknown>;
}

export interface ConfirmActionPayload {
  type: 'confirm';
  confirmed: boolean;
}

export interface ClickActionPayload {
  type: 'click';
  actionId?: string;
  actionKey?: string;
  [key: string]: unknown;
}

export interface RowSelectActionPayload {
  type: 'row_select';
  rowIndex: number;
  rowData?: Record<string, unknown>;
}

export type UIActionPayload =
  | SelectActionPayload
  | SubmitActionPayload
  | ConfirmActionPayload
  | ClickActionPayload
  | RowSelectActionPayload;

export interface UIAction {
  componentType?: UIResponse['type'];
  actionKey?: string;
  type?: 'selection' | 'form_submit' | 'confirmation' | 'button_click' | string;
  payload?: UIActionPayload | unknown;
}

// ==========================================
// 4. AI 结构化响应协议
// ==========================================

export interface UIResponseContext {
  sessionStage?: string;
  collectedData?: Record<string, unknown>;
}

export interface AIUIResponse {
  message: string;
  components: UIResponse[];
  context?: UIResponseContext;
}

/**
 * 前端聊天消息结构
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  components?: UIResponse[];
  context?: UIResponseContext;
  timestamp: number;
  isActionFeedback?: boolean;
}
