import { runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph.js';

interface TestCase {
  id: number;
  title: string;
  input: string;
  expectedIntent: 'analyze' | 'query' | 'chat' | Array<'analyze' | 'query'>;
  validate: (result: any, durationMs: number) => { pass: boolean; reason?: string };
}

const testCases: TestCase[] = [
  {
    id: 1,
    title: '完整需求分析',
    input:
      '分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型（单选、多选、填空、量表），支持逻辑跳转，数据导出Excel。',
    expectedIntent: 'analyze',
    validate: (res) => {
      const hasExtracted = res.extracted && Object.keys(res.extracted).length > 0;
      const hasClarified = res.clarified && typeof res.clarified === 'object';
      const hasAnalysis = Boolean(res.analysisResult && res.analysisResult.trim().length > 0);
      const hasRisk = Boolean(res.riskResult && res.riskResult.trim().length > 0);
      const hasSummary = Boolean(res.summary && res.summary.trim().length > 0);

      const pass =
        res.intent === 'analyze' &&
        hasExtracted &&
        hasClarified &&
        hasAnalysis &&
        hasRisk &&
        hasSummary;

      return {
        pass,
        reason: pass
          ? '所有需求分析核心字段 (extracted, clarified, analysisResult, riskResult, summary) 均非空'
          : `缺失部分字段: extracted=${!!hasExtracted}, clarified=${!!hasClarified}, analysisResult=${!!hasAnalysis}, riskResult=${!!hasRisk}, summary=${!!hasSummary}`,
      };
    },
  },
  {
    id: 2,
    title: '需求状态查询',
    input: '查询 REQ-20240315-001 的当前状态',
    expectedIntent: 'query',
    validate: (res) => {
      const hasQueryResponse = Boolean(res.queryResponse && res.queryResponse.trim().length > 0);
      const analysisUndefined = res.analysisResult === undefined;
      const riskUndefined = res.riskResult === undefined;
      const extractedUndefined = res.extracted === undefined;

      const pass =
        res.intent === 'query' &&
        hasQueryResponse &&
        analysisUndefined &&
        riskUndefined &&
        extractedUndefined;

      return {
        pass,
        reason: pass
          ? 'queryResponse 非空，且业务分析节点产物 (analysisResult, riskResult, extracted) 为 undefined'
          : `断言失败: queryResponse=${!!hasQueryResponse}, analysisResultUndefined=${analysisUndefined}, riskResultUndefined=${riskUndefined}, extractedUndefined=${extractedUndefined}`,
      };
    },
  },
  {
    id: 3,
    title: '普通闲聊',
    input: '你好，今天天气不错',
    expectedIntent: 'chat',
    validate: (res, durationMs) => {
      const hasChatResponse = Boolean(res.chatResponse && res.chatResponse.trim().length > 0);
      const noBusinessNodes =
        res.extracted === undefined && !res.steps?.includes('extractStep');
      const timeOk = durationMs < 5000;

      const pass = res.intent === 'chat' && hasChatResponse && noBusinessNodes;

      return {
        pass,
        reason: pass
          ? `chatResponse 非空，业务分析节点未触发 (用时: ${durationMs}ms${timeOk ? ' < 5s' : ''})`
          : `断言失败: chatResponse=${!!hasChatResponse}, noBusinessNodes=${noBusinessNodes}, durationMs=${durationMs}`,
      };
    },
  },
  {
    id: 4,
    title: '模糊意图',
    input: '看看 REQ-20240315-001 有没有什么问题',
    expectedIntent: ['analyze', 'query'],
    validate: (res) => {
      const validIntent = res.intent === 'analyze' || res.intent === 'query';
      const hasOutput = Boolean(res.summary || res.queryResponse);

      const pass = validIntent && hasOutput;
      return {
        pass,
        reason: pass
          ? `明确决断为意图: ${res.intent}，且正常返回响应无死循环`
          : `未明确决断或未生成响应: intent=${res.intent}`,
      };
    },
  },
  {
    id: 5,
    title: '带编号的查询',
    input: 'REQ-20240415-002 的进度如何',
    expectedIntent: 'query',
    validate: (res) => {
      const pass =
        res.intent === 'query' &&
        Boolean(res.queryResponse && res.queryResponse.trim().length > 0);
      return {
        pass,
        reason: pass
          ? '根据需求编号高优先级准确路由至 query 分支并获取回复'
          : `未命中 query: intent=${res.intent}`,
      };
    },
  },
  {
    id: 6,
    title: '简短需求',
    input: '我需要一个用户登录功能',
    expectedIntent: 'analyze',
    validate: (res) => {
      const hasExtracted = Boolean(res.extracted);
      const hasSummary = Boolean(res.summary && res.summary.trim().length > 0);
      const pass = res.intent === 'analyze' && hasExtracted && hasSummary;
      return {
        pass,
        reason: pass
          ? '准确识别为 analyze 意图并执行了提取与分析流程'
          : `未命中 analyze: intent=${res.intent}, extracted=${!!hasExtracted}`,
      };
    },
  },
  {
    id: 7,
    title: '多重含义（查询优先于分析）',
    input: '查询 REQ-20240315-001 的风险分析报告',
    expectedIntent: 'query',
    validate: (res) => {
      const pass =
        res.intent === 'query' &&
        Boolean(res.queryResponse && res.queryResponse.trim().length > 0);
      return {
        pass,
        reason: pass
          ? '成功遵守“查询”优先级高于“分析”的规则，准确判为 query'
          : `多重含义判定异常: intent=${res.intent}`,
      };
    },
  },
];

async function runAllTests() {
  console.log('================================================================');
  console.log('       Requirement Analysis Graph 意图分类与路由自动化测试       ');
  console.log('================================================================\n');

  let passedCount = 0;
  const results: Array<{
    id: number;
    title: string;
    intent: string;
    expected: string;
    pass: boolean;
    durationMs: number;
    reason?: string;
  }> = [];

  for (const tc of testCases) {
    process.stdout.write(`正在执行 Case ${tc.id}: ${tc.title} ... `);
    const start = Date.now();
    try {
      const output = await runAnalysisGraph(tc.input);
      const durationMs = Date.now() - start;

      const isIntentMatch = Array.isArray(tc.expectedIntent)
        ? tc.expectedIntent.includes(output.intent as any)
        : output.intent === tc.expectedIntent;

      const validation = tc.validate(output, durationMs);
      const pass = isIntentMatch && validation.pass;

      if (pass) {
        passedCount++;
        console.log(`[PASS] (${durationMs}ms) -> intent=${output.intent}`);
      } else {
        console.log(`[FAIL] (${durationMs}ms) -> intent=${output.intent}`);
      }

      results.push({
        id: tc.id,
        title: tc.title,
        intent: output.intent,
        expected: Array.isArray(tc.expectedIntent)
          ? tc.expectedIntent.join(' | ')
          : tc.expectedIntent,
        pass,
        durationMs,
        reason: validation.reason,
      });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.log(`[ERROR] (${durationMs}ms): ${err?.message || err}`);
      results.push({
        id: tc.id,
        title: tc.title,
        intent: 'error',
        expected: Array.isArray(tc.expectedIntent)
          ? tc.expectedIntent.join(' | ')
          : tc.expectedIntent,
        pass: false,
        durationMs,
        reason: `执行异常: ${err?.message || err}`,
      });
    }
  }

  console.log('\n======================== 测试执行详细报告 ========================');
  for (const r of results) {
    const statusMark = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(
      `${statusMark} | Case ${r.id}: ${r.title.padEnd(16)} | 耗时: ${String(r.durationMs).padStart(5)}ms | 意图: ${r.intent} (期望: ${r.expected})`,
    );
    if (r.reason) {
      console.log(`       └─ ${r.reason}`);
    }
  }

  const accuracy = Math.round((passedCount / testCases.length) * 100);
  console.log('================================================================');
  console.log(`测试统计: 共 ${testCases.length} 个场景，通过 ${passedCount} 个，失败 ${testCases.length - passedCount} 个`);
  console.log(`意图分类准确率: ${accuracy}% (验收标准: ≥ 85%)`);

  const passedThreshold = accuracy >= 85;
  if (passedThreshold) {
    console.log('🎉 验收结论: 达标！所有核心指标满足交付标准。\n');
    process.exit(0);
  } else {
    console.log('⚠️ 验收结论: 未达标！准确率低于 85%，请排查分类规则与提示词。\n');
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('测试脚本执行失败:', err);
  process.exit(1);
});
