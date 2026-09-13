import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  uiResponseSchema,
  aiUIResponseSchema,
  uiActionSchema,
} from './ui-schemas.js';
import type {
  UIResponse,
  AIUIResponse,
  UIAction,
  SelectionComponent,
  CardComponent,
  ConfirmationComponent,
  StepsComponent,
  FormComponent,
  TableComponent,
  ActionButtonsComponent,
} from './ui-types.js';
import { UIResponseService, UI_RESPONSE_SYSTEM_PROMPT } from './ui-response.service.js';
import { UIFlowService } from './ui-flow.service.js';
import { UIChatController } from './ui-chat.controller.js';

describe('UI 响应协议与 Structured Output 规范测试套件', () => {
  // =========================================================================
  // 1. Zod Schema 模式校验与精确匹配
  // =========================================================================
  describe('1. Zod Schema 模式校验 (ui-schemas.ts)', () => {
    it('1.1 text 组件：合法 Markdown 文本应校验通过', () => {
      const data: UIResponse = {
        type: 'text',
        content: '# 需求分析报告\n- 核心动作: 用户注册\n- 约束: 必须校验手机号',
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('text');
      }
    });

    it('1.2 selection 组件：单选/多选及选项列表应校验通过', () => {
      const data: SelectionComponent = {
        type: 'selection',
        title: '请选择需求类别',
        description: '请根据业务方向勾选',
        mode: 'single',
        actionKey: 'select_req_type',
        options: [
          { label: '业务功能', value: 'feature', description: '新特性' },
          { label: '性能优化', value: 'optimization', disabled: false },
        ],
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.3 form 组件：必须支持 input, select, textarea, date, number 字段类型', () => {
      const data: FormComponent = {
        type: 'form',
        title: '需求信息录入表单',
        submitText: '提交评审',
        actionKey: 'submit_req_form',
        fields: [
          { name: 'reqName', label: '需求名称', type: 'input', required: true },
          {
            name: 'priority',
            label: '优先级',
            type: 'select',
            options: [{ label: '高', value: 'P1' }],
          },
          { name: 'desc', label: '详细描述', type: 'textarea' },
          { name: 'releaseDate', label: '上线日期', type: 'date' },
          { name: 'estimate', label: '预估工时', type: 'number', defaultValue: 3 },
        ],
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.4 confirmation 组件：确认操作摘要及按钮配置校验', () => {
      const data: ConfirmationComponent = {
        type: 'confirmation',
        title: '确认提交需求分析',
        summary: '系统将执行智能抽取，预计耗时2秒',
        details: { 需求编号: 'REQ-20240315-001', 紧急度: '高' },
        confirmText: '确认',
        cancelText: '取消',
        actionKey: 'confirm_analysis',
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.5 card 组件：信息展示卡片校验', () => {
      const data: CardComponent = {
        type: 'card',
        title: '需求卡片 REQ-20240315-001',
        subtitle: '用户注册流程',
        status: '进行中',
        fields: [
          { label: '类型', value: '功能需求' },
          { label: '责任人', value: '张工' },
        ],
        footer: '由 AI 自动生成',
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.6 steps 组件：步骤进度条校验', () => {
      const data: StepsComponent = {
        type: 'steps',
        title: '需求生命周期',
        currentStep: 1,
        items: [
          { title: '收集', status: 'finish' },
          { title: '抽取', status: 'process' },
          { title: '评审', status: 'wait' },
        ],
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.7 table 组件：数据表格校验', () => {
      const data: TableComponent = {
        type: 'table',
        title: '历史关联需求',
        columns: [
          { key: 'id', title: '编号' },
          { key: 'name', title: '名称' },
        ],
        rows: [{ id: 'REQ-01', name: '登录认证' }],
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.8 action_buttons 组件：操作按钮组校验', () => {
      const data: ActionButtonsComponent = {
        type: 'action_buttons',
        title: '推荐下一步操作',
        buttons: [
          { label: '查看详情', actionKey: 'view_detail', variant: 'primary' },
          { label: '取消修改', actionKey: 'cancel', variant: 'secondary' },
        ],
      };
      const result = uiResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('1.9 辨别联合 (discriminatedUnion)：当 type 字段未知或缺失时应抛出校验错误', () => {
      const invalidData = {
        type: 'unknown_component',
        foo: 'bar',
      };
      const result = uiResponseSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('1.10 aiUIResponseSchema：能正确校验包含 message 和 components 复合结构的响应', () => {
      const aiResponse: AIUIResponse = {
        message: '已为您查询到需求详情并进入待确认步骤',
        components: [
          {
            type: 'confirmation',
            title: '确认提交',
            summary: '即将提交需求分析',
          },
          {
            type: 'steps',
            currentStep: 2,
            items: [{ title: '第一步' }, { title: '第二步' }],
          },
        ],
      };
      const result = aiUIResponseSchema.safeParse(aiResponse);
      expect(result.success).toBe(true);
    });

    it('1.11 uiActionSchema：能正确校验回传的操作格式', () => {
      const action: UIAction = {
        type: 'selection',
        actionKey: 'select_requirement_type',
        payload: { selectedValue: 'feature' },
      };
      const result = uiActionSchema.safeParse(action);
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // 2. UI 响应服务与业务场景测试 (UIResponseService)
  // =========================================================================
  describe('2. UI 响应服务场景与 Structured Output (UIResponseService)', () => {
    let service: UIResponseService;

    beforeEach(() => {
      service = new UIResponseService();
      vi.restoreAllMocks();
    });

    it('2.1 测试要求用例 1: 输入 "我要提一个新需求" → 应返回 selection 组件（选择需求类型）', async () => {
      const res = await service.generateUIResponse('我要提一个新需求');

      expect(res).toBeDefined();
      expect(res.message).toContain('需求类型');
      expect(res.components.length).toBeGreaterThanOrEqual(1);

      const selectionComp = res.components.find(
        (c): c is SelectionComponent => c.type === 'selection',
      );
      expect(selectionComp).toBeDefined();
      expect(selectionComp?.mode).toBe('single');
      expect(selectionComp?.options.length).toBeGreaterThanOrEqual(3);
      expect(selectionComp?.options.some((o) => o.value === 'feature')).toBe(true);
    });

    it('2.2 测试要求用例 2: 输入 "查看需求 REQ-20240315-001" → 应返回 card 组件（需求详情卡片）', async () => {
      const res = await service.generateUIResponse('查看需求 REQ-20240315-001');

      expect(res).toBeDefined();
      expect(res.components.length).toBeGreaterThanOrEqual(1);

      const cardComp = res.components.find((c): c is CardComponent => c.type === 'card');
      expect(cardComp).toBeDefined();
      expect(cardComp?.title).toContain('REQ-20240315-001');
      expect(cardComp?.fields.some((f) => f.label === '需求编号')).toBe(true);
      expect(cardComp?.fields.some((f) => f.label === '核心约束')).toBe(true);
    });

    it('2.3 测试要求用例 3: 提交需求分析 → 应返回 confirmation 组件 + steps 组件', async () => {
      const res = await service.generateUIResponse('提交需求分析');

      expect(res).toBeDefined();
      expect(res.components.length).toBeGreaterThanOrEqual(2);

      const confirmationComp = res.components.find(
        (c): c is ConfirmationComponent => c.type === 'confirmation',
      );
      const stepsComp = res.components.find((c): c is StepsComponent => c.type === 'steps');

      expect(confirmationComp).toBeDefined();
      expect(confirmationComp?.title).toContain('确认');
      expect(confirmationComp?.actionKey).toBe('confirm_requirement_analysis');

      expect(stepsComp).toBeDefined();
      expect(stepsComp?.items.length).toBeGreaterThanOrEqual(3);
      expect(stepsComp?.currentStep).toBe(1);
    });

    it('2.4 当未命中固定规则时，应当使用 model.withStructuredOutput(aiUIResponseSchema) 约束生成', async () => {
      const mockResult: AIUIResponse = {
        message: '这是模型动态分析生成的界面',
        components: [
          {
            type: 'text',
            content: '模型识别到这是一条复杂的架构需求。',
          },
        ],
      };

      const mockInvoke = vi.fn().mockResolvedValue(mockResult);
      const mockStructuredModel = { invoke: mockInvoke };
      const mockWithStructuredOutput = vi.fn().mockReturnValue(mockStructuredModel);
      const mockModel = { withStructuredOutput: mockWithStructuredOutput } as any;

      const res = await service.generateUIResponse(
        '请帮我评估一下跨机房微服务分布式事务的容灾架构',
        [],
        undefined,
        mockModel,
      );

      expect(mockWithStructuredOutput).toHaveBeenCalledWith(aiUIResponseSchema, {
        method: 'functionCalling',
      });
      const invokedParam = mockInvoke.mock.calls[0][0];
      const messages = Array.isArray(invokedParam)
        ? invokedParam
        : invokedParam?.messages || invokedParam?.toChatMessages?.() || [];
      expect(messages[0].content).toContain(UI_RESPONSE_SYSTEM_PROMPT);
      expect(res).toEqual(mockResult);
    });

    it('2.5 当大模型调用异常时，应优雅降级返回兜底建议操作', async () => {
      const mockModel = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi.fn().mockRejectedValue(new Error('OpenAI API 限流')),
        }),
      } as any;

      const res = await service.generateUIResponse(
        '任意未命中规则的复杂提问',
        [],
        undefined,
        mockModel,
      );

      expect(res.message).toContain('遇到轻微波动');
      expect(res.components.some((c) => c.type === 'action_buttons')).toBe(true);
    });
  });

  // =========================================================================
  // 3. UI Action 处理与确定性状态机测试 (UIFlowService)
  // =========================================================================
  describe('3. UI Action 处理与确定性状态机 (UIFlowService)', () => {
    let flowService: UIFlowService;
    const sessionId = 'test-flow-session-001';

    beforeEach(() => {
      flowService = new UIFlowService();
      flowService.resetSession(sessionId);
    });

    it('3.1 步骤 1: 用户完成 selection 选择需求类型后，状态机流转到表单填写并返回 form 组件', async () => {
      const action: UIAction = {
        type: 'selection',
        actionKey: 'select_requirement_type',
        payload: { selectedValue: 'feature' },
      };

      const res = await flowService.handleAction(sessionId, action);

      expect(res.message).toContain('业务功能需求');
      const formComp = res.components.find((c): c is FormComponent => c.type === 'form');
      expect(formComp).toBeDefined();
      expect(formComp?.actionKey).toBe('submit_requirement_form');

      // 验证表单字段完整包含 input, select, textarea, date, number
      const fieldTypes = formComp?.fields.map((f) => f.type);
      expect(fieldTypes).toContain('input');
      expect(fieldTypes).toContain('select');
      expect(fieldTypes).toContain('textarea');
      expect(fieldTypes).toContain('date');
      expect(fieldTypes).toContain('number');
    });

    it('3.2 步骤 2: 用户提交 form 表单后，状态机推进到确认状态并返回 confirmation + card', async () => {
      // 先选择需求类型进入 fill_detail
      await flowService.handleAction(sessionId, {
        type: 'selection',
        actionKey: 'select_requirement_type',
        payload: { selectedValue: 'feature' },
      });

      // 再提交表单
      const formSubmitAction: UIAction = {
        type: 'form_submit',
        actionKey: 'submit_requirement_form',
        payload: {
          title: '电子发票即时开具与推送',
          priority: 'P0',
          targetReleaseDate: '2026-10-15',
          description: '开票请求必须经过税务前置机验真',
        },
      };

      const res = await flowService.handleAction(sessionId, formSubmitAction);

      expect(res.message).toContain('需求详情已暂存');
      const confirmComp = res.components.find(
        (c): c is ConfirmationComponent => c.type === 'confirmation',
      );
      const cardComp = res.components.find((c): c is CardComponent => c.type === 'card');

      expect(confirmComp).toBeDefined();
      expect(confirmComp?.summary).toContain('电子发票即时开具与推送');
      expect(confirmComp?.details?.['优先级']).toBe('P0');

      expect(cardComp).toBeDefined();
      expect(cardComp?.title).toBe('需求信息预览: 电子发票即时开具与推送');
      expect(res.context?.sessionStage).toBe('confirm');
    });

    it('3.3 步骤 3: 用户在 confirmation 对话框中点击确认后，推进到完成状态并返回 steps + card + action_buttons', async () => {
      // 触发确认 (confirmed: true)
      const confirmAction: UIAction = {
        type: 'confirmation',
        actionKey: 'confirm_requirement_analysis',
        payload: { confirmed: true },
      };

      const res = await flowService.handleAction(sessionId, confirmAction);

      expect(res.message).toContain('智能分析');
      const stepsComp = res.components.find((c): c is StepsComponent => c.type === 'steps');
      const cardComp = res.components.find((c): c is CardComponent => c.type === 'card');
      const buttonsComp = res.components.find(
        (c): c is ActionButtonsComponent => c.type === 'action_buttons',
      );

      expect(stepsComp).toBeDefined();
      expect(stepsComp?.currentStep).toBe(3);
      expect(cardComp).toBeDefined();
      expect(cardComp?.status).toBe('已就绪 (Ready)');
      expect(buttonsComp).toBeDefined();
      expect(buttonsComp?.buttons.length).toBeGreaterThanOrEqual(2);
      expect(res.context?.sessionStage).toBe('result');
    });

    it('3.4 步骤 3 (分支): 用户在 confirmation 对话框中点击取消时，应回退到 fill_detail 表单阶段', async () => {
      const cancelAction: UIAction = {
        type: 'confirmation',
        actionKey: 'cancel_requirement_analysis',
        payload: { confirmed: false },
      };

      const res = await flowService.handleAction(sessionId, cancelAction);

      expect(res.message).toContain('已取消提交');
      expect(res.components.some((c) => c.type === 'form')).toBe(true);
      expect(res.context?.sessionStage).toBe('fill_detail');
    });

    it('3.5 通用按钮点击 (button_click): 点击重新发起能够重置状态机至 select_type', async () => {
      const resetAction: UIAction = {
        type: 'button_click',
        actionKey: 'create_new_requirement',
      };

      const res = await flowService.handleAction(sessionId, resetAction);

      expect(res.message).toContain('需求的类型');
      expect(res.components.some((c) => c.type === 'selection')).toBe(true);
      expect(res.context?.sessionStage).toBe('select_type');
    });
  });

  // =========================================================================
  // 4. API 控制器端点测试 (UIChatController)
  // =========================================================================
  describe('4. 控制器端点测试 (@Controller("api/ui-chat"))', () => {
    let controller: UIChatController;
    let uiResponseService: UIResponseService;
    let uiFlowService: UIFlowService;

    beforeEach(() => {
      uiResponseService = new UIResponseService();
      uiFlowService = new UIFlowService();
      controller = new UIChatController(uiResponseService, uiFlowService);
    });

    it('4.1 POST /api/ui-chat/chat: 正常请求应返回 AIUIResponse', async () => {
      const result = await controller.chat({
        sessionId: 'session-chat-test',
        input: '我要提一个新需求',
      });

      expect(result).toBeDefined();
      expect(result.components.some((c) => c.type === 'selection')).toBe(true);
    });

    it('4.2 POST /api/ui-chat/chat: 入参缺失 sessionId 或 input 时应抛出 BadRequestException', async () => {
      await expect(
        controller.chat({ sessionId: '', input: '我要提需求' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.chat({ sessionId: 's1', input: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('4.3 POST /api/ui-chat/action: 正常操作回传应正确调用 uiFlowService 并返回结果', async () => {
      const action: UIAction = {
        type: 'selection',
        actionKey: 'select_requirement_type',
        payload: { selectedValue: 'feature' },
      };

      const result = await controller.action({
        sessionId: 'session-action-test',
        action,
      });

      expect(result).toBeDefined();
      expect(result.components.some((c) => c.type === 'form')).toBe(true);
    });

    it('4.4 POST /api/ui-chat/action: action 格式不合法或缺失关键字段时抛出 BadRequestException', async () => {
      await expect(
        controller.action({
          sessionId: 'session-invalid',
          action: { type: 'invalid_type' as any, actionKey: 'test' },
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.action({
          sessionId: '',
          action: { type: 'selection', actionKey: 'test' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('4.5 状态机交互规范测试: 支持 componentType 与 payload 判别联合，并携带 context 状态元数据', async () => {
      const tutorialAction: UIAction = {
        componentType: 'selection',
        payload: {
          type: 'select',
          selectedId: 'functional',
        },
      };

      const result = await controller.action({
        sessionId: 'session-tutorial-test',
        action: tutorialAction,
      });

      expect(result).toBeDefined();
      expect(result.components.some((c) => c.type === 'form')).toBe(true);
      // 验证包含状态上下文快照
      expect(result.context).toBeDefined();
      expect(result.context?.sessionStage).toBe('fill_detail');
      expect(result.context?.collectedData?.requirementType).toBe('functional');
    });

    it('4.6 POST /api/ui-chat/generate: 正常入参应直接调用 uiResponseService 并返回无状态组件', async () => {
      const result = await controller.generate({
        input: '我要提一个新需求',
        context: { source: 'editor-extension' },
      });

      expect(result).toBeDefined();
      expect(result.components.length).toBeGreaterThan(0);
      expect(result.components.some((c) => c.type === 'selection')).toBe(true);
    });

    it('4.7 POST /api/ui-chat/generate: 入参缺失 input 时抛出 BadRequestException', async () => {
      await expect(controller.generate({ input: '' } as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.generate(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('4.8 POST /api/ui-chat/generate: 当大模型抛出异常时，应自动触发平滑降级 fallback', async () => {
      // Mock uiResponseService 抛出异常
      vi.spyOn(uiResponseService, 'generateUIResponse').mockRejectedValueOnce(
        new Error('DashScope API Rate Limit'),
      );

      const fallbackSpy = vi.spyOn(uiFlowService, 'handleInput');

      const result = await controller.generate({
        input: '生成需求分析表单',
      });

      expect(fallbackSpy).toHaveBeenCalledWith('ui-generate-fallback', '生成需求分析表单');
      expect(result).toBeDefined();
      expect(result.components.some((c) => c.type === 'selection')).toBe(true);
    });
  });

  // =========================================================================
  // 5. 需求分析流程完整 UI 交互闭环测试 (同一 sessionId 依次推进与回退)
  // =========================================================================
  describe('5. 需求分析流程完整 UI 交互闭环测试 (同一 sessionId)', () => {
    let controller: UIChatController;
    let uiResponseService: UIResponseService;
    let uiFlowService: UIFlowService;
    const testSessionId = 'session-loop-excel-001';

    beforeEach(() => {
      uiResponseService = new UIResponseService();
      uiFlowService = new UIFlowService();
      controller = new UIChatController(uiResponseService, uiFlowService);
      uiFlowService.resetSession(testSessionId);
    });

    it('5.1 完整需求分析流程闭环: Stage 0(问候) -> Stage 1(选类型) -> Stage 2(填表单) -> Stage 3(确认) -> Stage 4(产出 steps+card+actions)', async () => {
      // 阶段 0: POST /api/ui-chat/chat 输入 "你好" -> 返回常用服务入口 action_buttons
      const resStage0 = await controller.chat({
        sessionId: testSessionId,
        input: '你好',
      });
      expect(resStage0).toBeDefined();
      expect(resStage0.components.some((c) => c.type === 'action_buttons')).toBe(true);
      expect(resStage0.message).toContain('您好');

      // 阶段 1: POST /api/ui-chat/chat 输入 "我要提一个新需求：用户希望能够批量导入 Excel 数据"
      const resStage1 = await controller.chat({
        sessionId: testSessionId,
        input: '我要提一个新需求：用户希望能够批量导入 Excel 数据',
      });

      expect(resStage1).toBeDefined();
      expect(resStage1.context?.sessionStage).toBe('select_type');
      expect(resStage1.components.some((c) => c.type === 'selection')).toBe(true);
      expect(resStage1.context?.collectedData?.initialInput).toContain('批量导入 Excel 数据');

      // 阶段 2: POST /api/ui-chat/action 触发 select functional
      const resStage2 = await controller.action({
        sessionId: testSessionId,
        action: {
          componentType: 'selection',
          payload: {
            type: 'select',
            selectedId: 'functional',
          },
        },
      });

      expect(resStage2).toBeDefined();
      expect(resStage2.context?.sessionStage).toBe('fill_detail');
      expect(resStage2.components.some((c) => c.type === 'form')).toBe(true);
      const formComp = resStage2.components.find((c): c is FormComponent => c.type === 'form');
      expect(formComp?.title).toContain('业务功能需求');
      expect(formComp?.fields.some((f) => f.defaultValue?.toString().includes('批量导入 Excel 数据'))).toBe(true);

      // 阶段 3: POST /api/ui-chat/action 触发 submit 表单
      const resStage3 = await controller.action({
        sessionId: testSessionId,
        action: {
          componentType: 'form',
          payload: {
            type: 'submit',
            formData: {
              title: '批量导入 Excel 数据功能',
              priority: 'P0',
              targetReleaseDate: '2026-10-15',
              description: '支持批量解析并在前端进行数据合法性校验',
            },
          },
        },
      });

      expect(resStage3).toBeDefined();
      expect(resStage3.context?.sessionStage).toBe('confirm');
      // 验证包含 confirmation 对话框 + card 卡片
      expect(resStage3.components.some((c) => c.type === 'confirmation')).toBe(true);
      expect(resStage3.components.some((c) => c.type === 'card')).toBe(true);
      const confirmComp = resStage3.components.find((c): c is ConfirmationComponent => c.type === 'confirmation');
      expect(confirmComp?.summary).toContain('批量导入 Excel 数据功能');

      // 阶段 4: POST /api/ui-chat/action 触发 confirm true
      const resStage4 = await controller.action({
        sessionId: testSessionId,
        action: {
          componentType: 'confirmation',
          payload: {
            type: 'confirm',
            confirmed: true,
          },
        },
      });

      expect(resStage4).toBeDefined();
      expect(resStage4.context?.sessionStage).toBe('result');
      // 验证包含 steps 进度条 + card 全息卡片 + action_buttons 按钮组 (三件套)
      expect(resStage4.components.some((c) => c.type === 'steps')).toBe(true);
      expect(resStage4.components.some((c) => c.type === 'card')).toBe(true);
      expect(resStage4.components.some((c) => c.type === 'action_buttons')).toBe(true);
      const stepsComp = resStage4.components.find((c): c is StepsComponent => c.type === 'steps');
      expect(stepsComp?.currentStep).toBe(3);
      const cardComp = resStage4.components.find((c): c is CardComponent => c.type === 'card');
      expect(cardComp?.status).toBe('已就绪 (Ready)');
    });

    it('5.2 回退机制测试: 在 confirm 阶段点击取消，状态机回退到 fill_detail 并保留已填表单数据', async () => {
      // 先推进到 confirm 阶段
      await controller.chat({
        sessionId: testSessionId,
        input: '我要提一个新需求：用户希望能够批量导入 Excel 数据',
      });
      await controller.action({
        sessionId: testSessionId,
        action: {
          componentType: 'selection',
          payload: { type: 'select', selectedId: 'functional' },
        },
      });
      await controller.action({
        sessionId: testSessionId,
        action: {
          componentType: 'form',
          payload: {
            type: 'submit',
            formData: {
              title: '批量导入 Excel 数据（草稿）',
              priority: 'P1',
              description: '用户要求提供撤销导入功能',
            },
          },
        },
      });

      // 在 confirm 阶段触发取消操作 (confirmed: false)
      const rollbackRes = await controller.action({
        sessionId: testSessionId,
        action: {
          componentType: 'confirmation',
          payload: {
            type: 'confirm',
            confirmed: false,
          },
        },
      });

      // 验证回退到 fill_detail 阶段
      expect(rollbackRes).toBeDefined();
      expect(rollbackRes.context?.sessionStage).toBe('fill_detail');
      expect(rollbackRes.components.some((c) => c.type === 'form')).toBe(true);
      const formComp = rollbackRes.components.find((c): c is FormComponent => c.type === 'form');
      // 验证之前填写的标题被正确恢复
      expect(formComp?.fields.find((f) => f.name === 'title')?.defaultValue).toBe('批量导入 Excel 数据（草稿）');
    });
  });
});
