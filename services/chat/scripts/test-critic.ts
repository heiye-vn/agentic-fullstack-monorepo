import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  createSummarySubGraph,
  runAnalysisGraph,
} from '../src/llm/graph/requirement-analysis-graph.js';

interface CriticTestCase {
  id: number;
  title: string;
  description: string;
  run: () => Promise<{ pass: boolean; path: string[]; detail: string }>;
}

async function main() {
  console.log('================================================================');
  console.log('    Requirement Analysis 8.6 Critic-Refine 汇总子图质量闭环验证   ');
  console.log('================================================================\n');

  const testCases: CriticTestCase[] = [
    // -------------------------------------------------------------------------
    // 场景 1: 高质量初稿直接通过 (actor → critic → END)
    // -------------------------------------------------------------------------
    {
      id: 1,
      title: '高质量初稿直接通过评审 (无需修订)',
      description: '初稿已满足四大核心评审标准，critic 判定 pass=true，直接输出无需进入 refine',
      run: async () => {
        const fullReport = `# 需求规格说明书 (SRS)

## 需求摘要
本项目旨在构建一个高可用的商户优惠券领取与核销核心模块，提供清晰的防刷规则与有效期控制。

## 功能分解
- 优惠券领取流转：发券策略与库存削减
- 优惠券核销结算：订单金额抵扣与撤销回滚

## 冲突分析
与既有营销优惠引擎不存在冲突，统一复用现有营销总线接口进行优惠核销。

## 技术复杂度
评估为中等（Medium）：核心在于高并发发券场景下的 Redis 扣减一致性与分布式锁。

## 开发排期
- 第一阶段：接口与数据表设计（3天）
- 第二阶段：后端发券核心链路（5天，依赖第一阶段完成）
- 第三阶段：前端组件与端到端联调（4天，依赖第二阶段 API 交付）`;

        const mockPassModel: any = {
          withStructuredOutput: () => ({
            invoke: async () => ({
              pass: true,
              critique: '',
              issues: [],
            }),
          }),
          invoke: async () => new AIMessage(fullReport),
        };

        const subGraph = createSummarySubGraph(mockPassModel);
        const recordedPath: string[] = [];

        const stream = await subGraph.stream(
          {
            messages: [new HumanMessage('测试优惠券模块')],
            extracted: { action: '构建优惠券' },
            analysisResult: '分析完成',
            riskResult: '风控完成',
            reviseCount: 0,
          },
          { streamMode: 'updates' },
        );

        let finalSummary = '';
        for await (const chunk of stream) {
          const nodeName = Object.keys(chunk)[0];
          if (nodeName) {
            recordedPath.push(nodeName);
            const payload = (chunk as any)[nodeName];
            if (payload?.summary) {
              finalSummary = payload.summary;
            }
          }
        }

        const pass =
          recordedPath.includes('actor') &&
          recordedPath.includes('critic') &&
          !recordedPath.includes('refine') &&
          Boolean(finalSummary);

        return {
          pass,
          path: recordedPath,
          detail: pass
            ? `初稿质量优秀，直接通过评审，流转路径: [${recordedPath.join(' → ')}]`
            : `流转路径异常或误进入 refine: [${recordedPath.join(' → ')}]`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 场景 2: 缺陷初稿触发针对性修订 (actor → critic → refine → critic → END)
    // -------------------------------------------------------------------------
    {
      id: 2,
      title: '缺陷初稿触发批评修订与复审通过 (回边闭环)',
      description: '初稿缺少排期依赖，critic 提出修改意见，refine 修补后回边复审通过',
      run: async () => {
        let criticCallCount = 0;
        let refineCallCount = 0;

        const dynamicMockModel: any = {
          withStructuredOutput: () => ({
            invoke: async () => {
              criticCallCount++;
              if (criticCallCount === 1) {
                return {
                  pass: false,
                  critique: '开发排期缺少前后端阶段的依赖关系说明，请明确标明依赖项。',
                  issues: ['缺少排期依赖说明'],
                };
              }
              return {
                pass: true,
                critique: '',
                issues: [],
              };
            },
          }),
          invoke: async () => {
            refineCallCount++;
            return new AIMessage(
              '# 修订后需求规格说明书\n\n已补全开发排期依赖项：前端联调明确依赖后端 API 交付完成。',
            );
          },
        };

        const subGraph = createSummarySubGraph(dynamicMockModel);
        const recordedPath: string[] = [];

        const stream = await subGraph.stream(
          {
            messages: [new HumanMessage('测试修订流程')],
            extracted: { action: '测试' },
            analysisResult: '分析完成',
            riskResult: '风控完成',
            reviseCount: 0,
          },
          { streamMode: 'updates' },
        );

        let finalSummary = '';
        for await (const chunk of stream) {
          const nodeName = Object.keys(chunk)[0];
          if (nodeName) {
            recordedPath.push(nodeName);
            const payload = (chunk as any)[nodeName];
            if (payload?.summary) {
              finalSummary = payload.summary;
            }
          }
        }

        const pass =
          criticCallCount === 2 &&
          refineCallCount >= 1 &&
          recordedPath.includes('refine') &&
          finalSummary.includes('已补全开发排期依赖项');

        return {
          pass,
          path: recordedPath,
          detail: pass
            ? `成功触发针对性修订与二次复审通过，完整路径: [${recordedPath.join(' → ')}]`
            : `未能正确形成闭环: criticCount=${criticCallCount}, refineCount=${refineCallCount}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 场景 3: 达到 2 次修订上限强制退出防死循环 (reviseCount >= 2)
    // -------------------------------------------------------------------------
    {
      id: 3,
      title: '2 次修订硬上限强制截断 (防死循环保护)',
      description: '当模型持续提出修改意见时，在达到第 2 次修订后硬退出，避免无限循环',
      run: async () => {
        let actorCallCount = 0;
        let criticCallCount = 0;
        let refineCallCount = 0;

        const harshMockModel: any = {
          withStructuredOutput: () => ({
            invoke: async () => {
              criticCallCount++;
              return {
                pass: false,
                critique: '要求进一步润色冲突规避措施',
                issues: ['冲突措施不够完美'],
              };
            },
          }),
          invoke: async () => {
            if (actorCallCount === 0) {
              actorCallCount++;
              return new AIMessage('# 初稿需求说明书\n基础功能已完成，但缺少冲突规避方案。');
            }
            refineCallCount++;
            return new AIMessage(`### 修订版本 ${refineCallCount}\n继续优化冲突方案。`);
          },
        };

        const subGraph = createSummarySubGraph(harshMockModel);
        const recordedPath: string[] = [];

        const stream = await subGraph.stream(
          {
            messages: [new HumanMessage('测试无限循环拦截')],
            extracted: { action: '测试' },
            analysisResult: '分析完成',
            riskResult: '风控完成',
            reviseCount: 0,
          },
          { streamMode: 'updates' },
        );

        for await (const chunk of stream) {
          const nodeName = Object.keys(chunk)[0];
          if (nodeName) {
            recordedPath.push(nodeName);
          }
        }

        // 路径应该为：actor -> critic -> refine (1) -> critic -> refine (2) -> critic -> END
        const refineStepCount = recordedPath.filter((n) => n === 'refine').length;
        const pass = refineCallCount === 2 && criticCallCount === 3 && refineStepCount === 2;

        return {
          pass,
          path: recordedPath,
          detail: pass
            ? `成功在达到第 ${refineCallCount} 次修订后硬上限终止，防死循环生效！路径: [${recordedPath.join(' → ')}]`
            : `硬上限拦截异常: refineTimes=${refineCallCount}, criticTimes=${criticCallCount}`,
        };
      },
    },

    // -------------------------------------------------------------------------
    // 场景 4: 主图端到端运行验证 (ReAct + Critic-Refine 双子图全链路)
    // -------------------------------------------------------------------------
    {
      id: 4,
      title: '主图全链路贯通 (双子图级联运行)',
      description: '验证主图 extract -> clarify -> analysis(ReAct子图) -> risk -> summary(Critic-Refine子图) 完整闭环',
      run: async () => {
        const input =
          '分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型与导出';
        const result = await runAnalysisGraph(input);

        const hasAnalysis = Boolean(result.analysisResult && result.analysisResult.length > 50);
        const hasSummary = Boolean(result.summary && result.summary.length > 50);
        const hasExtracted = Boolean(result.extracted);

        const pass = result.intent === 'analyze' && hasAnalysis && hasSummary && hasExtracted;

        return {
          pass,
          path: [
            'classifier',
            'extractStep',
            'clarifyStep',
            'analysisStep(ReAct子图)',
            'riskStep',
            'summaryStep(Critic-Refine子图)',
          ],
          detail: pass
            ? `全链路执行成功，输出 Summary 长度: ${result.summary?.length} 字符，意图=${result.intent}`
            : `主图执行失败: hasAnalysis=${hasAnalysis}, hasSummary=${hasSummary}`,
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

  console.log('\n======================== Critic-Refine 验收测试总览 ========================');
  for (const r of reports) {
    const mark = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(
      `${mark} | Case ${r.id}: ${r.title.padEnd(26)} | 耗时: ${String(r.durationMs).padStart(5)}ms`,
    );
    console.log(`       路径: ${r.path.join(' → ')}`);
    console.log(`       结果: ${r.detail}`);
  }

  console.log('================================================================');
  console.log(`测试统计: 共 ${testCases.length} 个场景，通过 ${passedTotal} 个，失败 ${testCases.length - passedTotal} 个`);
  const passRate = Math.round((passedTotal / testCases.length) * 100);
  console.log(`通过率: ${passRate}% (验收基线: 100%)`);

  if (passedTotal === testCases.length) {
    console.log('🎉 验收结论: 达成交付标准！Critic-Refine 子图具备完善质量闭环与硬退出保护。\n');
    process.exit(0);
  } else {
    console.log('⚠️ 验收结论: 未达标！有测试场景失败，请排查。\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('测试脚本执行失败:', err);
  process.exit(1);
});
