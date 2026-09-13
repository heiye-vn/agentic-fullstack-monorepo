import { Injectable, Logger } from '@nestjs/common';
import type {
  AIUIResponse,
  UIAction,
  FormComponent,
  ConfirmationComponent,
  StepsComponent,
  CardComponent,
  ActionButtonsComponent,
  SelectionComponent,
} from './ui-types.js';

/**
 * 需求分析流程 4 阶段状态枚举
 */
export enum RequirementFlowStep {
  SELECT_TYPE = 'select_type',
  FILL_DETAIL = 'fill_detail',
  CONFIRM = 'confirm',
  RESULT = 'result',
}

/**
 * 会话流转状态上下文
 */
export interface FlowStateContext {
  sessionId: string;
  step: RequirementFlowStep;
  requirementType?: string;
  formData?: Record<string, any>;
  initialInput?: string;
  lastUpdatedAt: number;
}

@Injectable()
export class UIFlowService {
  private readonly logger = new Logger(UIFlowService.name);

  /**
   * 内存维护各会话的确定性状态机
   */
  private readonly sessionStates = new Map<string, FlowStateContext>();

  /**
   * 初始化或重置会话到 Stage 1: select_type（选择需求类型）
   *
   * @param sessionId 会话标识符
   * @param initialInput 用户输入的原始自然语言文本
   */
  initFlow(sessionId: string, initialInput: string): AIUIResponse {
    const sId = sessionId?.trim() || 'default-session';
    const state: FlowStateContext = {
      sessionId: sId,
      step: RequirementFlowStep.SELECT_TYPE,
      initialInput: initialInput?.trim() || '',
      lastUpdatedAt: Date.now(),
    };
    this.sessionStates.set(sId, state);

    this.logger.log(`[UIFlowService] 初始化会话到 Stage 1 (select_type): sessionId=${sId}`);

    const selectionComp: SelectionComponent = {
      type: 'selection',
      title: '请选择需求类型',
      description: '这将决定后续需求分析的重点评估维度与技术模版：',
      mode: 'single',
      allowMultiple: false,
      actionKey: 'select_requirement_type',
      options: [
        {
          id: 'functional',
          value: 'functional',
          label: '业务功能需求 (Functional)',
          description: '涉及新业务功能特性、交互流程或界面录入',
          icon: 'feature',
        },
        {
          id: 'performance',
          value: 'performance',
          label: '非功能/性能优化 (Performance)',
          description: '大数据量处理、高并发优化或系统延迟指标',
          icon: 'speed',
        },
        {
          id: 'security',
          value: 'security',
          label: '数据安全与合规 (Security)',
          description: '用户权限认证、数据校验与敏感信息保护',
          icon: 'shield',
        },
        {
          id: 'ui_ux',
          value: 'ui_ux',
          label: '界面体验改进 (UI/UX)',
          description: '操作易用性改进与批量数据交互体验',
          icon: 'design',
        },
      ],
    };

    return {
      message: '已为您创建新需求草稿。请先选择该需求的类型，我将调出对应的需求分析表单：',
      components: [selectionComp],
      context: {
        sessionStage: state.step,
        collectedData: {
          initialInput: state.initialInput,
        },
      },
    };
  }

  /**
   * 处理自然语言输入，初始化或重置流程状态（兼具降级兜底承接）
   *
   * @param sessionId 会话标识符
   * @param input 用户输入文本
   */
  handleInput(sessionId: string, input: string): AIUIResponse {
    return this.initFlow(sessionId, input);
  }

  /**
   * 处理用户在前端 UI 组件上的操作回传数据，推进确定性状态机
   *
   * @param sessionId 会话标识符
   * @param action 前端回传的交互动作
   */
  async handleAction(
    sessionId: string,
    action: UIAction,
  ): Promise<AIUIResponse> {
    const sId = sessionId?.trim() || 'default-session';
    const state = this.getOrCreateState(sId);

    const payloadType = action?.payload?.type;
    const actionType = action?.type;
    const compType = action?.componentType;

    this.logger.log(
      `[UIFlowService] 处理用户操作: sessionId=${sId}, 当前阶段=${state.step}, payloadType=${payloadType}, actionType=${actionType}`,
    );

    // 1. Stage 1 (select_type) -> Stage 2 (fill_detail): 用户选择需求类型
    if (payloadType === 'select' || actionType === 'selection' || compType === 'selection') {
      return this.handleSelectTypeAction(state, action);
    }

    // 2. Stage 2 (fill_detail) -> Stage 3 (confirm): 用户提交详情表单
    if (payloadType === 'submit' || actionType === 'form_submit' || compType === 'form') {
      return this.handleFillDetailSubmitAction(state, action);
    }

    // 3. Stage 3 (confirm) -> Stage 4 (result) 或 回退到 Stage 2: 用户确认/取消操作
    if (payloadType === 'confirm' || actionType === 'confirmation' || compType === 'confirmation') {
      return this.handleConfirmAction(state, action);
    }

    // 4. 通用按钮点击 (如重新提需求、查看详情)
    if (payloadType === 'click' || actionType === 'button_click' || compType === 'action_buttons') {
      return this.handleButtonClickAction(state, action);
    }

    // 5. 表格行选择
    if (payloadType === 'row_select' || compType === 'table') {
      return this.handleRowSelectAction(state, action);
    }

    this.logger.warn(`未识别的操作类型: ${payloadType || actionType || compType}`);
    return {
      message: '收到操作请求，但未匹配到当前阶段可执行的动作。',
      components: [
        {
          type: 'text',
          content: `不支持的操作类型: ${payloadType || actionType || compType || '未知'}`,
        },
      ],
      context: {
        sessionStage: state.step,
        collectedData: state.formData,
      },
    };
  }

  /**
   * Stage 1 -> Stage 2: 处理选择需求类型 (select)
   * 推进到 fill_detail 阶段，返回动态表单 form
   */
  private handleSelectTypeAction(
    state: FlowStateContext,
    action: UIAction,
  ): AIUIResponse {
    const selectedType =
      action.payload?.selectedId ||
      action.payload?.selectedValue ||
      action.payload?.value ||
      (typeof action.payload === 'string' ? action.payload : 'functional');

    state.requirementType = String(selectedType);
    state.step = RequirementFlowStep.FILL_DETAIL;
    state.lastUpdatedAt = Date.now();

    const typeLabels: Record<string, string> = {
      functional: '业务功能需求',
      feature: '业务功能需求',
      performance: '性能优化需求',
      non_functional: '非功能/性能优化需求',
      security: '数据安全需求',
      bugfix: '缺陷修复需求',
      ui_ux: '界面体验改进',
    };
    const typeName = typeLabels[state.requirementType] || '通用需求';

    // 尝试从用户的初始输入提取预设标题
    let defaultTitle = '批量导入 Excel 数据功能';
    let defaultDesc = '支持用户通过 Excel 文件批量导入多行业务数据，提供表头校验与错误数据高亮提示。';
    if (state.initialInput) {
      const match = state.initialInput.match(/[:：]\s*(.+)/);
      if (match && match[1]) {
        defaultTitle = match[1].trim();
        defaultDesc = `关于【${defaultTitle}】的核心业务主流程与必须满足的数据约束条件。`;
      }
    }

    const formComp: FormComponent = {
      type: 'form',
      title: `${typeName} - 填写需求详情`,
      description: '请补充以下需求规格与约束信息，以便系统进行精准的结构化分析与架构评估：',
      submitText: '提交需求分析',
      submitLabel: '提交需求分析',
      actionKey: 'submit_requirement_form',
      fields: [
        {
          name: 'title',
          label: '需求名称',
          type: 'input',
          placeholder: '请输入需求名称',
          required: true,
          defaultValue: defaultTitle,
        },
        {
          name: 'priority',
          label: '优先级',
          type: 'select',
          required: true,
          defaultValue: 'P1',
          options: [
            { label: 'P0 - 紧急阻断', value: 'P0' },
            { label: 'P1 - 高优先级', value: 'P1' },
            { label: 'P2 - 中优先级', value: 'P2' },
            { label: 'P3 - 低优先级/优化', value: 'P3' },
          ],
        },
        {
          name: 'estimatedDays',
          label: '预估工期 (人日)',
          type: 'number',
          placeholder: '预估开发与测试人日',
          required: false,
          defaultValue: 3,
        },
        {
          name: 'targetReleaseDate',
          label: '期望交付日期',
          type: 'date',
          placeholder: 'YYYY-MM-DD',
          required: true,
          defaultValue: '2026-10-15',
        },
        {
          name: 'description',
          label: '详细描述与核心约束',
          type: 'textarea',
          placeholder: '详细业务背景、必须满足的约束规则...',
          required: true,
          defaultValue: defaultDesc,
        },
      ],
    };

    return {
      message: `已为您选定【${typeName}】类型。请填写以下需求详情表单：`,
      components: [formComp],
      context: {
        sessionStage: state.step,
        collectedData: {
          initialInput: state.initialInput,
          requirementType: state.requirementType,
        },
      },
    };
  }

  /**
   * Stage 2 -> Stage 3: 处理提交需求详情表单 (submit)
   * 推进到 confirm 阶段，返回 confirmation 确认对话框 + card 信息卡片
   */
  private handleFillDetailSubmitAction(
    state: FlowStateContext,
    action: UIAction,
  ): AIUIResponse {
    state.formData = action.payload?.formData || action.payload || {};
    state.step = RequirementFlowStep.CONFIRM;
    state.lastUpdatedAt = Date.now();

    const title = state.formData?.title || '批量导入 Excel 数据功能';
    const priority = state.formData?.priority || 'P1';
    const releaseDate = state.formData?.targetReleaseDate || '2026-10-15';
    const desc = state.formData?.description || '支持 Excel 文件批量解析与数据验真';
    const reqCode = 'REQ-20240315-001';

    // 确认分析结果组件 (图 5 下半部分)
    const confirmationComp: ConfirmationComponent = {
      type: 'confirmation',
      title: '确认分析结果',
      summary: `已完成“${title}”需求分析，当前已整理出需求概述、功能分解、验收标准、依赖关系、补充建议及风险评估。请确认该分析结果是否作为后续细化输入。`,
      warning: '确认后可进入下一步需求细化或方案设计。',
      details: {
        需求编号: reqCode,
        需求主题: title,
        业务优先级: priority,
        期望交付: releaseDate,
      },
      confirmText: '确认结果',
      cancelText: '返回修改',
      actionKey: 'confirm_requirement_analysis',
    };

    // 分析结果摘要卡片组件 (图 5 上半部分)
    const cardComp: CardComponent = {
      type: 'card',
      title: '分析结果摘要',
      subtitle: `编号: ${reqCode} · 类别: ${state.requirementType || 'functional'}`,
      status: '分析完成',
      fields: [
        { label: '需求主题', value: title },
        { label: '目标用户', value: state.formData?.targetUser || '系统终端用户 / 业务运营人员' },
        { label: '核心流程', value: '参数校验 → 逻辑流转 → 数据入库 → 结果审计反馈' },
        { label: '关键补充能力', value: '幂等校验保护、异常 Fallback、操作审计记录、重试保障' },
        { label: '主要风险', value: '数据边界不清、性能与并发未评估、事务隔离一致性风险' },
        { label: '待进一步确认', value: '具体字段清单、外部接口依赖规范、失败兜底策略与上限规则' },
      ],
      footer: '请核对上方需求分析结果，点击“确认结果”完成归档。',
    };

    return {
      message: '需求分析已生成，请查阅分析结果摘要并确认：',
      components: [cardComp, confirmationComp],
      context: {
        sessionStage: state.step,
        collectedData: {
          initialInput: state.initialInput,
          requirementType: state.requirementType,
          requirementCode: reqCode,
          formData: state.formData,
        },
      },
    };
  }

  /**
   * Stage 3 -> Stage 4 或 回退到 Stage 2: 处理确认/取消提交 (confirm)
   * confirmed 为 true 时，推进到 result 阶段，返回 steps + action_buttons
   * confirmed 为 false 时，回退到 fill_detail 阶段，返回 form
   */
  private handleConfirmAction(
    state: FlowStateContext,
    action: UIAction,
  ): AIUIResponse {
    const isConfirmed =
      action.payload?.confirmed === true ||
      action.payload === true ||
      (typeof action.actionKey === 'string' && action.actionKey.includes('confirm') && !action.actionKey.includes('cancel'));

    // 分支 1：用户点击取消 -> 触发状态回退 (Stage 3 -> Stage 2)
    if (!isConfirmed) {
      state.step = RequirementFlowStep.FILL_DETAIL;
      state.lastUpdatedAt = Date.now();

      this.logger.log(`[UIFlowService] 用户取消确认，状态机回退到 Stage 2 (fill_detail)`);

      // 重新生成表单，并将之前填写的数据回填为 defaultValue，允许用户修改
      const formComp: FormComponent = {
        type: 'form',
        title: '修改需求详情表单',
        description: '已恢复您之前输入的信息，您可以修改后重新提交：',
        submitText: '重新提交分析',
        submitLabel: '重新提交分析',
        actionKey: 'submit_requirement_form',
        fields: [
          {
            name: 'title',
            label: '需求名称',
            type: 'input',
            required: true,
            defaultValue: state.formData?.title || '批量导入 Excel 数据功能',
          },
          {
            name: 'priority',
            label: '优先级',
            type: 'select',
            required: true,
            defaultValue: state.formData?.priority || 'P1',
            options: [
              { label: 'P0 - 紧急阻断', value: 'P0' },
              { label: 'P1 - 高优先级', value: 'P1' },
              { label: 'P2 - 中优先级', value: 'P2' },
              { label: 'P3 - 低优先级/优化', value: 'P3' },
            ],
          },
          {
            name: 'estimatedDays',
            label: '预估工期 (人日)',
            type: 'number',
            required: false,
            defaultValue: state.formData?.estimatedDays || 3,
          },
          {
            name: 'targetReleaseDate',
            label: '期望交付日期',
            type: 'date',
            required: true,
            defaultValue: state.formData?.targetReleaseDate || '2026-10-15',
          },
          {
            name: 'description',
            label: '详细描述与核心约束',
            type: 'textarea',
            required: true,
            defaultValue: state.formData?.description || '',
          },
        ],
      };

      return {
        message: '您已取消提交。已为您恢复表单内容，请修改后重新提交：',
        components: [formComp],
        context: {
          sessionStage: state.step,
          collectedData: {
            initialInput: state.initialInput,
            requirementType: state.requirementType,
            formData: state.formData,
          },
        },
      };
    }

    // 分支 2：用户确认提交 -> 推进到 Stage 4 (result)
    state.step = RequirementFlowStep.RESULT;
    state.lastUpdatedAt = Date.now();

    this.logger.log(`[UIFlowService] 用户确认提交，状态机推进到 Stage 4 (result)`);

    const title = state.formData?.title || '批量导入 Excel 数据功能';
    const reqCode = 'REQ-20240315-001';

    // 步骤进度条组件：标记流程完成
    const stepsComp: StepsComponent = {
      type: 'steps',
      title: '需求分析流程进度',
      currentStep: 3,
      items: [
        { title: '类型选择', description: '已确定需求类别', status: 'finish' },
        { title: '信息录入', description: '需求表单填写完成', status: 'finish' },
        { title: '确认提交', description: '用户已确认启动分析', status: 'finish' },
        { title: '分析完成', description: '结构化抽取与评审就绪', status: 'finish' },
      ],
    };

    // 分析结果全息卡片组件
    const cardComp: CardComponent = {
      type: 'card',
      title: `需求分析档案: ${title}`,
      subtitle: `编号: ${reqCode} · 类别: ${state.requirementType || 'functional'}`,
      status: '已就绪 (Ready)',
      fields: [
        { label: '需求编号', value: reqCode },
        { label: '需求名称', value: title },
        { label: '业务优先级', value: (state.formData?.priority as string) || 'P1' },
        { label: '期望交付', value: (state.formData?.targetReleaseDate as string) || '2026-10-15' },
        { label: '核心动作抽取', value: '批量数据解析 -> 表头规则校验 -> 事务性入库' },
        { label: '业务约束规则', value: (state.formData?.description as string) || '支持 Excel 文件批量解析与数据验真' },
        { label: '分析状态', value: '结构化抽取与评审完成 (Completed)' },
      ],
      footer: '由需求分析智能体编排引擎生成 · 随时可通过快捷按钮导出或查看详情',
    };

    // 操作按钮组组件：展示后续操作入口
    const actionButtonsComp: ActionButtonsComponent = {
      type: 'action_buttons',
      title: '后续操作建议',
      layout: 'horizontal',
      buttons: [
        {
          id: 'view_report',
          label: '查看完整分析报告',
          actionKey: 'view_requirement_detail',
          payload: { reqId: reqCode },
          variant: 'primary',
        },
        {
          id: 'export_doc',
          label: '导出需求规格说明书',
          actionKey: 'export_requirement_spec',
          payload: { reqId: reqCode },
          variant: 'secondary',
        },
        {
          id: 'create_new',
          label: '提下一个需求',
          actionKey: 'create_new_requirement',
          variant: 'secondary',
        },
      ],
    };

    return {
      message: `需求【${title}】已顺利提交并完成智能分析！您可以通过下方卡片核对结果或通过按钮导出文档。`,
      components: [stepsComp, cardComp, actionButtonsComp],
      context: {
        sessionStage: state.step,
        collectedData: {
          initialInput: state.initialInput,
          requirementType: state.requirementType,
          requirementCode: reqCode,
          formData: state.formData,
          status: 'completed',
        },
      },
    };
  }

  /**
   * 处理快捷操作按钮点击 (click)
   */
  private handleButtonClickAction(
    state: FlowStateContext,
    action: UIAction,
  ): AIUIResponse {
    const actKey = action.actionKey || action.payload?.actionId || action.payload?.actionKey;

    if (actKey === 'create_new_requirement' || actKey === 'reselect_type') {
      return this.initFlow(state.sessionId, '');
    }

    if (actKey === 'view_requirement_detail') {
      return {
        message: '已为您调出需求分析全息卡片：',
        components: [
          {
            type: 'card',
            title: `需求规格详情: ${state.formData?.title || '批量导入 Excel 数据'}`,
            subtitle: '编号: REQ-20240315-001',
            status: '已就绪 (Ready)',
            fields: [
              { label: '核心主动作', value: '批量导入并解析 Excel 记录' },
              { label: '明确约束', value: '支持 xlsx/csv 格式，单次限制不超过 5000 行' },
              { label: '提取实体', value: 'Excel 文件, 数据行, 校验错误列表' },
            ],
          },
        ],
        context: {
          sessionStage: state.step,
          collectedData: state.formData,
        },
      };
    }

    return {
      message: `操作【${actKey || '未命名'}】已执行完毕。`,
      components: [
        {
          type: 'text',
          content: `操作【${actKey}】已成功触发。`,
        },
      ],
      context: {
        sessionStage: state.step,
        collectedData: state.formData,
      },
    };
  }

  /**
   * 处理表格行选择操作 (row_select)
   */
  private handleRowSelectAction(
    state: FlowStateContext,
    action: UIAction,
  ): AIUIResponse {
    const rowIndex = action.payload?.rowIndex ?? 0;
    return {
      message: `您已选中表格第 ${rowIndex + 1} 行记录：`,
      components: [
        {
          type: 'card',
          title: `行数据详情 (Index: ${rowIndex})`,
          fields: [
            { label: '行索引', value: String(rowIndex) },
            { label: '当前状态', value: '已选定' },
          ],
        },
      ],
      context: {
        sessionStage: state.step,
        collectedData: {
          ...state.formData,
          selectedRowIndex: rowIndex,
        },
      },
    };
  }

  /**
   * 获取或初始化会话状态
   */
  private getOrCreateState(sessionId: string): FlowStateContext {
    let state = this.sessionStates.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        step: RequirementFlowStep.SELECT_TYPE,
        lastUpdatedAt: Date.now(),
      };
      this.sessionStates.set(sessionId, state);
    }
    return state;
  }

  /**
   * 清理或重置指定会话状态（提供给测试使用）
   */
  public resetSession(sessionId: string): void {
    this.sessionStates.delete(sessionId);
  }

  /**
   * 获取指定会话状态快照（提供给测试使用）
   */
  public getSessionState(sessionId: string): FlowStateContext | undefined {
    return this.sessionStates.get(sessionId);
  }
}
