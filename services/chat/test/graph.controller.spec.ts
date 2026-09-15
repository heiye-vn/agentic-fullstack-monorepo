import { describe, it, expect } from 'vitest';
import { GraphController } from '../src/llm/graph/graph.controller.js';
import { BadRequestException } from '@nestjs/common';

describe('GraphController Unit Spec', () => {
  const controller = new GraphController();

  it('GET /api/graph/mermaid 应正常返回主图 Mermaid 字符串', () => {
    const res = controller.getMermaid();
    expect(res).toHaveProperty('mermaid');
    expect(typeof res.mermaid).toBe('string');
    expect(res.mermaid).toContain('graph TD;');
    expect(res.mermaid).toContain('classifier');
    expect(res.mermaid).toContain('analysisStep');
  });

  it('GET /api/graph/subgraph-mermaid 应正常返回 ReAct 子图 Mermaid 字符串', () => {
    const res = controller.getSubGraphMermaid();
    expect(res).toHaveProperty('mermaid');
    expect(typeof res.mermaid).toBe('string');
    expect(res.mermaid).toContain('agent');
    expect(res.mermaid).toContain('tools');
    expect(res.mermaid).toContain('finalize');
  });

  it('GET /api/graph/summary-mermaid 应正常返回 Critic-Refine 子图 Mermaid 字符串', () => {
    const res = controller.getSummaryMermaid();
    expect(res).toHaveProperty('mermaid');
    expect(typeof res.mermaid).toBe('string');
    expect(res.mermaid).toContain('actor');
    expect(res.mermaid).toContain('critic');
    expect(res.mermaid).toContain('refine');
  });

  it('POST /api/graph/analyze 当 input 为空时应抛出 BadRequestException', async () => {
    await expect(controller.analyze({ input: '' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.analyze({ input: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
