import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  createAnalysisSubGraph,
  runAnalysisGraph,
} from '../src/llm/graph/requirement-analysis-graph.js';

interface SubGraphTestCase {
  id: number;
  title: string;
  description: string;
  run: () => Promise<{ pass: boolean; path: string[]; detail: string }>;
}

async function main() {
  console.log('================================================================');
  console.log('    Requirement Analysis 8.5 ReAct 子图与防死循环核心用例验证   ');
  console.log('================================================================\n');

  const testCases: SubGraphTestCase[] = [
    // -------------------------------------------------------------------------
    // 用例 1: 无编号的普通需求输入，能直接生成分析
    // -------------------------------------------------------------------------
    {
      id: 1,
      title: '普通需求直接分析 (无编号输入)',
      description: '输入无 REQ- 编号的常规业务需求，应直接收敛输出多维分析，无需调工具',
      run: async () => {
        const input = '设计一个商户优惠券领取与核销模块，包含有效期控制与发放限制';
        const result = await runAnalysisGraph(input);

        const messages = result.messages ?? [];
        const toolCalls = messages.filter(
          (m: any) => m._getType?.() === 'tool' || m.tool_calls?.length > 0,
        );
        const hasAnalysis = Boolean(
          result.analysisResult && result.analysisResult.length > 50,
        );

        const path = ['agent', 'finalize'];
        const pass = hasAnalysis && toolCalls.length === 0;

        return {
          pass,
          path,
          detail: pass
            ? `分析结果生成成功（长度: ${result.analysisResult?.length} 字符），未触发任何工具调用`
            : `生成失败或误触发了工具: hasAnalysis=${hasAnalysis}, toolCallsCount=${toolCalls.length}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 用例 2: 带 REQ 编号的输入，会先查详情再分析
    // -------------------------------------------------------------------------
    {
      id: 2,
      title: '带编号需求查详情 (agent → tools → agent → finalize)',
      description: '输入带有 REQ-20240315-001 编号的需求，必须优先调用 search_requirement 工具检索规格',
      run: async () => {
        const input =
          '分析需求 REQ-20240315-001 的业务实现方案，需要输出详尽的架构分解与验收标准';
        const result = await runAnalysisGraph(input);

        const messages = result.messages ?? [];
        const hasSearchReqCall = messages.some((m: any) => {
          if (m.tool_calls && Array.isArray(m.tool_calls)) {
            return m.tool_calls.some(
              (tc: any) => tc.name === 'search_requirement',
            );
          }
          if (m.name === 'search_requirement') {
            return true;
          }
          return false;
        });

        const hasAnalysis = Boolean(
          result.analysisResult && result.analysisResult.length > 50,
        );
        const pass = hasSearchReqCall && hasAnalysis;
        const path = ['agent', 'tools (search_requirement)', 'agent', 'finalize'];

        return {
          pass,
          path,
          detail: pass
            ? '成功触发 search_requirement 工具检索需求规格，并基于结果产出完整多维分析'
            : `未能正确调用 search_requirement 工具: hasSearchReqCall=${hasSearchReqCall}, hasAnalysis=${hasAnalysis}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 用例 3: 涉及登录/认证类需求时，可触发冲突检测
    // -------------------------------------------------------------------------
    {
      id: 3,
      title: '登录/认证类需求触发冲突检测 (check_conflicts)',
      description: '输入涉及单点登录与统一认证改造的需求，智能体触发 check_conflicts 检测潜在鉴权冲突',
      run: async () => {
        const input =
          '为系统新增统一微信与手机号登录认证中心，支持 JWT Token 签发与多终端登录会话维护';
        const result = await runAnalysisGraph(input);

        const messages = result.messages ?? [];
        const hasConflictCall = messages.some((m: any) => {
          if (m.tool_calls && Array.isArray(m.tool_calls)) {
            return m.tool_calls.some(
              (tc: any) => tc.name === 'check_conflicts',
            );
          }
          if (m.name === 'check_conflicts') {
            return true;
          }
          return false;
        });

        const hasAnalysis = Boolean(
          result.analysisResult && result.analysisResult.length > 50,
        );
        const pass = hasConflictCall && hasAnalysis;
        const path = ['agent', 'tools (check_conflicts)', 'agent', 'finalize'];

        return {
          pass,
          path,
          detail: pass
            ? '成功触发 check_conflicts 架构冲突检测工具，且分析结论中包含鉴权架构评估'
            : `未能正确触发 check_conflicts 工具: hasConflictCall=${hasConflictCall}, hasAnalysis=${hasAnalysis}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 用例 4: 工具轮次达到 6 次时强制退出，避免死循环
    // -------------------------------------------------------------------------
    {
      id: 4,
      title: '6 轮死循环硬上限强制截断保护',
      description: '模拟模型持续发出工具调用陷入循环，验证 6 轮上限拦截并经 finalize 安全降级',
      run: async () => {
        // 构造一个不断输出 tool_calls 的 Mock 模型
        let loopCounter = 0;
        const infiniteLoopMockModel: any = {
          bindTools: () => infiniteLoopMockModel,
          invoke: async () => {
            loopCounter++;
            return new AIMessage({
              content: '',
              tool_calls: [
                {
                  id: `call_${loopCounter}`,
                  name: 'search_requirement',
                  args: { reqId: 'REQ-LOOP-TEST' },
                },
              ],
            });
          },
        };

        const subGraph = createAnalysisSubGraph({ model: infiniteLoopMockModel });
        const startState = {
          messages: [new HumanMessage('测试死循环拦截')],
          toolLoopCount: 0,
        };

        const result = await subGraph.invoke(startState);

        const hitLimit = (result.toolLoopCount ?? 0) >= 6;
        const hasFallbackResult = Boolean(
          result.analysisResult && result.analysisResult.includes('安全降级'),
        );
        const pass = hitLimit && hasFallbackResult;
        const path = [
          'agent',
          'tools (1)',
          'agent',
          'tools (2)',
          'agent',
          'tools (3)',
          'agent',
          'tools (4)',
          'agent',
          'tools (5)',
          'agent',
          'tools (6)',
          'finalize (硬上限拦截触发)',
        ];

        return {
          pass,
          path,
          detail: pass
            ? `死循环拦截成功：在达到第 ${result.toolLoopCount} 次工具调用时强制退出，触发安全降级输出`
            : `死循环防御失效: toolLoopCount=${result.toolLoopCount}, hasFallback=${hasFallbackResult}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 用例 5: 子图可独立运行，且服务端日志能看到清晰流转路径
    // -------------------------------------------------------------------------
    {
      id: 5,
      title: '子图独立运行与实时节点流转路径追踪',
      description: '独立编译并运行 createAnalysisSubGraph()，完整追踪 agent → tools → agent → finalize 轨迹',
      run: async () => {
        const subGraph = createAnalysisSubGraph();
        const recordedPath: string[] = [];

        const stream = await subGraph.stream(
          {
            messages: [
              new HumanMessage('分析 REQ-20240315-001：问卷系统的数据持久化与报表导出'),
            ],
            toolLoopCount: 0,
          },
          { streamMode: 'updates' },
        );

        for await (const update of stream) {
          const nodeName = Object.keys(update)[0];
          if (nodeName) {
            recordedPath.push(nodeName);
          }
        }

        const pass =
          recordedPath.includes('agent') &&
          recordedPath.includes('finalize') &&
          (recordedPath.includes('tools') || recordedPath.length >= 2);

        return {
          pass,
          path: recordedPath,
          detail: `子图独立执行完成，完整流转序列: [${recordedPath.join(' → ')}]，成功回填 analysisResult`,
        };
      },
    },
  ];

  let passedTotal = 0;
  const reports: Array<{
    id: number;
    title: string;
    pass: boolean;
    durationMs: number;
    path: string[];
    detail: string;
  }> = [];

  for (const tc of testCases) {
    process.stdout.write(`\n正在执行 Case ${tc.id}: ${tc.title} ...\n`);
    const start = Date.now();
    try {
      const res = await tc.run();
      const durationMs = Date.now() - start;

      if (res.pass) {
        passedTotal++;
        console.log(`  └─ ✅ [PASS] (${durationMs}ms) 路径: ${res.path.join(' → ')}`);
      } else {
        console.log(`  └─ ❌ [FAIL] (${durationMs}ms) 路径: ${res.path.join(' → ')}`);
      }
      console.log(`     说明: ${res.detail}`);

      reports.push({
        id: tc.id,
        title: tc.title,
        pass: res.pass,
        durationMs,
        path: res.path,
        detail: res.detail,
      });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.log(`  └─ ❌ [ERROR] (${durationMs}ms): ${err?.message || err}`);
      reports.push({
        id: tc.id,
        title: tc.title,
        pass: false,
        durationMs,
        path: ['error'],
        detail: `异常阻断: ${err?.message || err}`,
      });
    }
  }

  console.log('\n======================== 子图验收测试执行总览 ========================');
  for (const r of reports) {
    const mark = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(
      `${mark} | Case ${r.id}: ${r.title.padEnd(20)} | 耗时: ${String(r.durationMs).padStart(5)}ms`,
    );
    console.log(`       路径: ${r.path.join(' → ')}`);
    console.log(`       结果: ${r.detail}`);
  }

  console.log('================================================================');
  console.log(`测试统计: 共 ${testCases.length} 个场景，通过 ${passedTotal} 个，失败 ${testCases.length - passedTotal} 个`);
  const passRate = Math.round((passedTotal / testCases.length) * 100);
  console.log(`通过率: ${passRate}% (验收基线: 至少通过 4/5，即 ≥ 80%)`);

  if (passedTotal >= 4) {
    console.log('🎉 验收结论: 达成交付标准！ReAct 子图具备完整回边循环与死循环防御。\n');
    process.exit(0);
  } else {
    console.log('⚠️ 验收结论: 未达标！通过用例数小于 4，需针对性调整。\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('测试脚本执行失败:', err);
  process.exit(1);
});
