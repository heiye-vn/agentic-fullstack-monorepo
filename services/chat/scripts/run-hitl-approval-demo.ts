/**
 * HITL 审批决策链 Demo — 第十八章 18.14 配套脚本
 *
 * 演示一个高风险动作从「Agent 想做」到「真正执行」之间要过的四道闸，
 * 以及每一步留下的审计痕迹：
 *   1. RiskBasedApproval —— 按风险分级决定要不要人签字、签几个
 *   2. KillSwitch        —— 紧急停止（含按会话作用域停止）
 *   3. ActionLog         —— 执行前留快照，事后知道能撤什么
 *   4. AuditLogger       —— 全程审计，只记形状不记内容
 *
 * 本脚本是**确定性**的：不调 LLM，跑起来秒级完成。
 *
 * 为什么不做 LangGraph 的 interrupt + Command({resume}) 那一段：
 * 那属于"编排层挂起与恢复"，必须真实调模型才能触发工具调用，
 * 结果不稳定也费钱。本脚本聚焦"决策层"——也就是拿到一个工具调用请求后，
 * 系统到底该放行、该拦下、还是该叫人来看。两者是同一条链上的前后两段。
 *
 * 运行：cd services/chat && npx tsx scripts/run-hitl-approval-demo.ts
 */
import {
  RiskBasedApproval,
  KillSwitch,
  KillSwitchEngagedError,
  ActionLog,
} from '../src/security/kill-switch.js';
import { AuditLogger } from '../src/security/audit-logger.js';
import { DataFlowGuard } from '../src/security/data-flow-guard.js';

const log = (msg: string) => console.log(`  ${msg}`);
const line = '─'.repeat(72);

const approval = new RiskBasedApproval();
const killSwitch = new KillSwitch();
const actionLog = new ActionLog();
const audit = new AuditLogger();
const dataGuard = new DataFlowGuard();

console.log('='.repeat(72));
console.log('  第十八章：HITL 审批决策链 Demo');
console.log('='.repeat(72));

// ── Demo 1: 风险分级 ──────────────────────────────────────────
console.log('\n▶ Demo 1: RiskBasedApproval — 不是所有操作都该弹审批');
console.log(line);
const candidates = [
  'search_knowledge_base',
  'create_requirement',
  'delete_requirement',
  'transfer_money',
  'sync_external_system',
];
for (const tool of candidates) {
  const strategy = approval.getStrategy(tool);
  const n = approval.requiredApprovals(tool);
  const human =
    n === 0 ? '自动执行' : n === Infinity ? '禁止执行' : `需 ${n} 人审批`;
  log(`${tool.padEnd(24)} ${strategy.padEnd(16)} ${human}`);
}
log('注意 sync_external_system 从未登记过 —— 默认要求审批，而不是静默放行');

// ── Demo 2: 一个高风险动作的完整决策链 ─────────────────────────
console.log('\n▶ Demo 2: 删除一条需求 —— 从意图到执行的四道闸');
console.log(line);

const tool = 'delete_requirement';
const agentId = 'agent-executor-1';
const conversationId = 'conv-1';

log(`Agent ${agentId} 请求执行 ${tool}`);

// 闸一：Kill Switch
try {
  killSwitch.assertActive({ agentId, conversationId });
  log('[闸1 KillSwitch] 未触发，继续');
} catch (e) {
  if (e instanceof KillSwitchEngagedError) log(`[闸1 KillSwitch] 已停止 → ${e.message}`);
}

// 闸二：风险分级 → 需要几人签字
const needed = approval.requiredApprovals(tool);
log(`[闸2 风险分级] ${approval.getStrategy(tool)}，需要 ${needed} 人审批`);

// 闸三：模拟审批（这里直接给"已收齐 2 个签名"）
const approved = true;
audit.logHumanDecision(tool, 'reviewer-A', approved, 'trace-1');
audit.logHumanDecision(tool, 'reviewer-B', approved, 'trace-1');
log('[闸3 人工审批] reviewer-A 通过 / reviewer-B 通过');

// 闸四：执行前留快照 + 数据流检查 + 审计
const snapshot = actionLog.record({
  agentId,
  action: tool,
  target: 'requirement:REQ-42',
  params: { requirementId: 'REQ-42' },
  reversible: true,
  compensationAction: '从审计快照恢复 REQ-42',
});
log(`[闸4 执行] 已留快照 ${snapshot.id}（可回滚：${snapshot.reversible}）`);

const outgoing = '删除需求 REQ-42（含联系人 zhangsan@company.com）';
const canSendToWeb = dataGuard.isAllowed(outgoing, 'web');
log(`[闸4 执行] 结果外发检查：允许发到 web = ${canSendToWeb}`);
if (!canSendToWeb) {
  audit.logDataFlowBlocked('confidential', 'web', agentId, 'trace-1');
}
audit.logToolInvocation(tool, agentId, 'success', { target: 'REQ-42' }, 'trace-1');

// ── Demo 3: Kill Switch 的作用域 ──────────────────────────────
console.log('\n▶ Demo 3: KillSwitch — 只停失控的那一个会话');
console.log(line);
killSwitch.kill('该会话陷入工具调用死循环', { conversationId: 'conv-bad' });
audit.logKillSwitchEngaged('该会话陷入工具调用死循环', 'ops-console');

log(`conv-bad 存活：${killSwitch.isActive({ conversationId: 'conv-bad' })}`);
log(`conv-1   存活：${killSwitch.isActive({ conversationId: 'conv-1' })}  ← 未被连坐`);
try {
  killSwitch.assertActive({ conversationId: 'conv-bad' });
} catch (e) {
  if (e instanceof KillSwitchEngagedError) log(`拦截：${e.message}`);
}
killSwitch.restore({ conversationId: 'conv-bad' });
log(`恢复后 conv-bad 存活：${killSwitch.isActive({ conversationId: 'conv-bad' })}`);

// ── Demo 4: 可回滚清单 ────────────────────────────────────────
console.log('\n▶ Demo 4: ActionLog — 事后知道能撤什么');
console.log(line);
actionLog.record({
  agentId,
  action: 'update_requirement',
  target: 'requirement:REQ-41',
  params: {},
  reversible: true,
  compensationAction: '回滚到上一版',
});
actionLog.record({
  agentId,
  action: 'send_email',
  target: 'ops@company.com',
  params: {},
  reversible: false,
});
for (const s of actionLog.getReversible()) {
  log(`[可回滚] ${s.action} → ${s.target}（补偿：${s.compensationAction ?? '无'}）`);
}
log(`共 ${actionLog.size} 条快照，其中 ${actionLog.getReversible().length} 条可回滚`);

// ── Demo 5: 审计日志 ──────────────────────────────────────────
console.log('\n▶ Demo 5: AuditLogger — 只记形状不记内容');
console.log(line);
audit.logSecretAccess('model-config:cfg-7', agentId, 'resolve_chat_model');
audit.logInjectionDetected(['ignore-instructions'], 256, 'user-9', 'trace-2');

log(`共 ${audit.size} 条审计事件`);
log(`按严重程度：${JSON.stringify(audit.countBySeverity())}`);
log('critical 级事件：');
for (const e of audit.query({ severity: 'critical' })) {
  log(`  [${e.eventType}] actor=${e.actor} target=${e.target} ${JSON.stringify(e.details)}`);
}

console.log('\n' + '='.repeat(72));
console.log('  演示完成。真实执行挂起/恢复（LangGraph interrupt + resume）');
console.log('  属于编排层，需要真实 LLM，见第十四/十五章的 deepagent 脚本。');
console.log('='.repeat(72));
