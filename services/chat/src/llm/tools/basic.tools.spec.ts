import { describe, it, expect } from 'vitest';
import {
  checkConstraintValidityTool,
  lookupEntityDefinitionTool,
  basicTools,
  toolsByName,
} from './basic.tools.js';

describe('Basic Tools', () => {
  describe('check_constraint_validity', () => {
    it('应包含正确的工具元数据', () => {
      expect(checkConstraintValidityTool.name).toBe('check_constraint_validity');
      expect(checkConstraintValidityTool.description).toContain('校验需求中的约束条件是否合规有效');
    });

    it('当约束包含强约束关键词时，判定为有效', async () => {
      const output = await checkConstraintValidityTool.invoke({
        constraint: '必须绑定手机号',
      });
      const parsed = JSON.parse(output);

      expect(parsed.isValid).toBe(true);
      expect(parsed.level).toBe('strict');
      expect(parsed.reason).toContain('必须');
    });

    it('当约束包含模糊词汇时，判定为弱约束并给出整改建议', async () => {
      const output = await checkConstraintValidityTool.invoke({
        constraint: '密码最好长一点，尽量包含数字',
      });
      const parsed = JSON.parse(output);

      expect(parsed.isValid).toBe(false);
      expect(parsed.level).toBe('weak');
      expect(parsed.reason).toContain('模糊词汇');
      expect(parsed.suggestion).toContain('建议改用绝对约束词');
    });

    it('当约束为空时，返回格式化错误提示', async () => {
      const output = await checkConstraintValidityTool.invoke({
        constraint: '   ',
      });
      const parsed = JSON.parse(output);

      expect(parsed.isValid).toBe(false);
      expect(parsed.reason).toContain('约束条件内容为空');
    });
  });

  describe('lookup_entity_definition', () => {
    it('应包含正确的工具元数据', () => {
      expect(lookupEntityDefinitionTool.name).toBe('lookup_entity_definition');
      expect(lookupEntityDefinitionTool.description).toContain('查询业务实体的领域标准定义');
    });

    it('能够成功查找到预设实体（如手机号）的定义', async () => {
      const output = await lookupEntityDefinitionTool.invoke({
        entity: '手机号',
      });
      const parsed = JSON.parse(output);

      expect(parsed.found).toBe(true);
      expect(parsed.domain).toBe('安全与身份认证');
      expect(parsed.definition).toContain('通信标识');
      expect(parsed.attributes).toContain('phone_number');
    });

    it('查询未预设实体时，返回未收录说明与建议', async () => {
      const output = await lookupEntityDefinitionTool.invoke({
        entity: '未知自定义实体X',
      });
      const parsed = JSON.parse(output);

      expect(parsed.found).toBe(false);
      expect(parsed.domain).toBe('业务扩展');
      expect(parsed.definition).toContain('属于业务扩展实体');
    });
  });

  describe('工具集合导出', () => {
    it('basicTools 数组包含两个已定义工具', () => {
      expect(basicTools).toHaveLength(2);
      expect(basicTools.map((t) => t.name)).toEqual([
        'check_constraint_validity',
        'lookup_entity_definition',
      ]);
    });

    it('toolsByName 正确建立字典映射', () => {
      expect(toolsByName['check_constraint_validity']).toBe(checkConstraintValidityTool);
      expect(toolsByName['lookup_entity_definition']).toBe(lookupEntityDefinitionTool);
    });
  });
});
