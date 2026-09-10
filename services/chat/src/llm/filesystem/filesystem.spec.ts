import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { BadRequestException } from '@nestjs/common';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  resolveSafePath,
  DEFAULT_WORKSPACE_ROOT,
  queryRequirementTool,
  readFileTool,
  writeFileTool,
} from '../tools/business.tools.js';
import { FilesystemService } from './filesystem.service.js';
import { FilesystemController } from './filesystem.controller.js';

describe('Filesystem & Business Tools Suite', () => {
  describe('1. safePath 沙箱路径安全性校验', () => {
    it('正常解析 workspace 内的相对路径', () => {
      const safePath = resolveSafePath('standards/requirement-spec.md');
      expect(safePath).toBe(
        path.resolve(DEFAULT_WORKSPACE_ROOT, 'standards/requirement-spec.md'),
      );
    });

    it('自动清洗并兼容模型或用户误带的 "workspace/" 前缀', () => {
      const safePath = resolveSafePath('workspace/standards/requirement-spec.md');
      expect(safePath).toBe(
        path.resolve(DEFAULT_WORKSPACE_ROOT, 'standards/requirement-spec.md'),
      );
    });

    it('当输入为空或只有空格时抛出异常', () => {
      expect(() => resolveSafePath('')).toThrow('路径参数不能为空');
      expect(() => resolveSafePath('   ')).toThrow('路径参数不能为空');
    });

    it('拦截空字符截断攻击', () => {
      expect(() => resolveSafePath('test.txt\0.js')).toThrow(
        '检测到空字符注入',
      );
    });

    it('严禁使用 ../ 进行目录遍历逃逸', () => {
      expect(() => resolveSafePath('../package.json')).toThrow(
        '安全沙箱限制：拒绝访问 workspace 外部路径',
      );
      expect(() => resolveSafePath('standards/../../package.json')).toThrow(
        '安全沙箱限制：拒绝访问 workspace 外部路径',
      );
    });
  });

  describe('2. business.tools 业务工具功能测试', () => {
    const testReportRelPath = 'reports/test-spec-report.md';
    let testReportAbsPath: string;

    beforeAll(() => {
      testReportAbsPath = resolveSafePath(testReportRelPath);
    });

    afterAll(async () => {
      if (existsSync(testReportAbsPath)) {
        await fs.unlink(testReportAbsPath);
      }
    });

    it('query_requirement: 成功读取已存在的 REQ-2026-001 需求单', async () => {
      const rawResult = await queryRequirementTool.invoke({
        requirementId: 'REQ-2026-001',
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.requirementId).toBe('REQ-2026-001');
      expect(result.data.title).toBe('需求分析智能体的会话记忆');
      expect(result.data.priority).toBe('high');
    });

    it('query_requirement: 自动处理末尾附带 .json 后缀的情况', async () => {
      const rawResult = await queryRequirementTool.invoke({
        requirementId: 'REQ-2026-001.json',
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.requirementId).toBe('REQ-2026-001');
    });

    it('query_requirement: 查询不存在的需求单返回友好提示', async () => {
      const rawResult = await queryRequirementTool.invoke({
        requirementId: 'REQ-9999-999',
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(false);
      expect(result.found).toBe(false);
      expect(result.message).toContain('未找到需求单');
    });

    it('query_requirement: 拦截包含路径穿越符号的非法编号', async () => {
      const rawResult = await queryRequirementTool.invoke({
        requirementId: '../REQ-001',
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(false);
      expect(result.error).toContain('非法需求单编号格式');
    });

    it('read_file: 成功读取 standards/requirement-spec.md 标准文档', async () => {
      const rawResult = await readFileTool.invoke({
        filePath: 'standards/requirement-spec.md',
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.content).toContain('需求规范与质量评估标准');
    });

    it('read_file: 读取不存在的文件返回明确提示', async () => {
      const rawResult = await readFileTool.invoke({
        filePath: 'standards/not-exist.md',
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(false);
      expect(result.found).toBe(false);
      expect(result.message).toContain('不存在');
    });

    it('write_file: 成功创建目录并写入分析报告，验证内容完整性', async () => {
      const testContent = '# 需求评审报告\n\n- 状态：通过\n- 审核人：AI架构师';
      const rawResult = await writeFileTool.invoke({
        filePath: testReportRelPath,
        content: testContent,
      });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(testReportRelPath);
      expect(result.bytesWritten).toBeGreaterThan(0);

      // 物理检查文件内容
      expect(existsSync(testReportAbsPath)).toBe(true);
      const fileContent = await fs.readFile(testReportAbsPath, 'utf-8');
      expect(fileContent).toBe(testContent);
    });
  });

  describe('3. FilesystemService Tool Loop 闭环执行测试', () => {
    it('模拟完整两轮交互：首轮触发工具调用并执行，次轮整合返回最终结论', async () => {
      const round1Response = new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_query_1',
            name: 'query_requirement',
            args: { requirementId: 'REQ-2026-001' },
          },
        ],
      });

      const round2Response = new AIMessage({
        content: '需求单 REQ-2026-001 核心功能为会话记忆隔离，分析完毕。',
        tool_calls: [],
        response_metadata: { model_name: 'test-llm' },
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 45,
          total_tokens: 165,
        },
      });

      const mockModel = {
        bindTools: vi.fn().mockReturnThis(),
        invoke: vi
          .fn()
          .mockResolvedValueOnce(round1Response)
          .mockResolvedValueOnce(round2Response),
      };

      const service = new FilesystemService();
      const result = await service.chat(
        '查询需求单 REQ-2026-001 的详情',
        5,
        mockModel,
      );

      expect(mockModel.bindTools).toHaveBeenCalled();
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      // 验证循环收集的步骤
      expect(result.iterations).toBe(2);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].toolCall.name).toBe('query_requirement');
      expect(result.steps[0].toolOutput).toContain('需求分析智能体的会话记忆');

      // 验证最终内容与模型元数据
      expect(result.finalContent).toBe(
        '需求单 REQ-2026-001 核心功能为会话记忆隔离，分析完毕。',
      );
      expect(result.model).toBe('test-llm');
      expect(result.usage).toEqual({
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
      });
    });

    it('当输入为空白时快速返回提示，不调用模型', async () => {
      const service = new FilesystemService();
      const result = await service.chat('   ');

      expect(result.iterations).toBe(0);
      expect(result.finalContent).toContain('请输入有效');
    });
  });

  describe('4. FilesystemController 路由测试', () => {
    it('POST chat 路由正常调用服务并返回结果', async () => {
      const mockResult = {
        input: '测试指令',
        finalContent: '执行完毕',
        iterations: 1,
        steps: [],
        model: 'test-model',
      };

      const mockService = {
        chat: vi.fn().mockResolvedValue(mockResult),
      } as unknown as FilesystemService;

      const controller = new FilesystemController(mockService);
      const res = await controller.chat({ input: '测试指令' });

      expect(mockService.chat).toHaveBeenCalledWith('测试指令');
      expect(res).toEqual(mockResult);
    });

    it('当请求体缺失 input 字段时抛出 BadRequestException', async () => {
      const mockService = {
        chat: vi.fn(),
      } as unknown as FilesystemService;

      const controller = new FilesystemController(mockService);

      await expect(controller.chat({} as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
