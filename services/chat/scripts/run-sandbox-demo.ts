/**
 * 沙箱与工具护栏 Demo — 第十八章 18.10 / 18.6 配套脚本
 *
 * 演示「损害半径控制」三层防护 + 工具调用护栏：
 *   1. PathValidator     —— 路径越界拦截（含 `..`、前缀混淆、软链接）
 *   2. EnvironmentFilter —— 密钥过滤（子进程不该继承父进程全部 env）
 *   3. ProcessSandbox    —— 受限子进程执行（限 cwd / env / 超时 / 输出 / 命令白名单）
 *   4. QuotaTracker + withToolGuards —— 工具调用配额与超时
 *   5. PermissionPolicy  —— 多 Agent 权限隔离
 *
 * 跨平台：工作目录用 os.tmpdir()，Node 代码用 process.execPath 执行，
 * Python 缺失时自动跳过（参照实现写死 python3，Windows 上必然 ENOENT）。
 *
 * 运行：cd services/chat && npx tsx scripts/run-sandbox-demo.ts
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PathValidator,
  PathEscapeError,
  EnvironmentFilter,
  ProcessSandbox,
  SandboxTimeoutError,
  SandboxOutputLimitError,
  SandboxCommandDeniedError,
} from '../src/security/sandbox.js';
import {
  QuotaTracker,
  withToolGuards,
  ToolQuotaError,
  ToolTimeoutError,
} from '../src/security/tool-runtime.js';
import { PermissionPolicy } from '../src/security/permission-model.js';

const log = (msg: string) => console.log(`  ${msg}`);
const line = '─'.repeat(72);

console.log('='.repeat(72));
console.log('  第十八章：沙箱与工具护栏 Demo');
console.log('='.repeat(72));

// 所有演示都限制在这个临时目录里，跑完不清理也不影响宿主机
const workDir = resolve(join(tmpdir(), 'agentic-ch18-sandbox-demo'));
mkdirSync(workDir, { recursive: true });
log(`沙箱工作目录：${workDir}`);

// ── Demo 1: 路径越界拦截 ──────────────────────────────────────
console.log('\n▶ Demo 1: PathValidator — 路径越界拦截');
console.log(line);
const pathValidator = new PathValidator([workDir]);
const testPaths = [
  join(workDir, 'report.md'),
  join(workDir, 'data', 'result.json'),
  '/etc/passwd',
  resolve(workDir, '..', '..', 'etc', 'shadow'),
  join(`${workDir}-evil`, 'leak.txt'), // 前缀混淆：看着像在目录内，其实不是
];
for (const p of testPaths) {
  try {
    pathValidator.validate(p);
    log(`[允许] ${p}`);
  } catch (e) {
    if (e instanceof PathEscapeError) log(`[拦截] ${p}`);
    else throw e;
  }
}

// ── Demo 2: 环境变量过滤 ──────────────────────────────────────
console.log('\n▶ Demo 2: EnvironmentFilter — 密钥过滤');
console.log(line);
const envFilter = new EnvironmentFilter();
const mockEnv: Record<string, string> = {
  PATH: '/usr/bin:/usr/local/bin',
  HOME: '/home/agent',
  SYSTEMROOT: 'C:\\Windows',
  NODE_ENV: 'production',
  OPENAI_API_KEY: 'sk-secret-key-do-not-leak',
  DATABASE_URL: 'postgres://admin:password@db:5432/prod',
  JWT_SECRET: 'super-secret-jwt',
  MODEL_CONFIG_SECRET: 'enc:v1:xxxx',
};
const safeEnv = envFilter.filter(mockEnv);
for (const [k, v] of Object.entries(mockEnv)) {
  const kept = k in safeEnv;
  log(`${kept ? '[保留]' : '[过滤]'} ${k} = ${kept ? v : '(已丢弃)'}`);
}
log(`过滤后 ${Object.keys(safeEnv).length}/${Object.keys(mockEnv).length} 个变量保留`);

// ── Demo 3: 进程沙箱执行 ──────────────────────────────────────
console.log('\n▶ Demo 3: ProcessSandbox — 受限子进程执行');
console.log(line);
const sandbox = new ProcessSandbox({
  workDir,
  timeoutMs: 5_000,
  maxOutputBytes: 100 * 1024,
});

const r1 = await sandbox.runNode('console.log("hello from sandbox")');
log(`执行 node: stdout=${r1.stdout.trim()} 退出码=${r1.exitCode} 耗时=${r1.durationMs}ms`);

const r2 = await sandbox.runNode('console.log(process.cwd())');
log(`子进程 cwd=${r2.stdout.trim()}（被锁在沙箱目录内）`);

// 关键演示：父进程有密钥，子进程看不到
process.env.CH18_DEMO_SECRET_KEY = 'leak-me-if-you-can';
try {
  const r3 = await sandbox.runNode(
    'console.log(process.env.CH18_DEMO_SECRET_KEY ?? "NOT_FOUND")',
  );
  log(`读取父进程密钥 CH18_DEMO_SECRET_KEY = ${r3.stdout.trim()} → 未泄露`);
} finally {
  delete process.env.CH18_DEMO_SECRET_KEY;
}

console.log('\n  三类失败分别是不同类型，排障不会查错方向：');

try {
  await new ProcessSandbox({ workDir, timeoutMs: 500 }).runNode('while(true){}');
} catch (e) {
  if (e instanceof SandboxTimeoutError) log(`[超时] ${e.message}`);
}

try {
  await new ProcessSandbox({ workDir, maxOutputBytes: 1024 }).runNode(
    'console.log("x".repeat(200000))',
  );
} catch (e) {
  if (e instanceof SandboxOutputLimitError) log(`[输出超限] ${e.message}`);
}

try {
  const locked = new ProcessSandbox({ workDir, allowedCommands: ['python'] });
  await locked.runNode('console.log(1)');
} catch (e) {
  if (e instanceof SandboxCommandDeniedError) log(`[命令不在白名单] ${e.message}`);
}

// Python 是可选的：Windows 上通常只有 python 没有 python3，都没有就跳过
console.log('\n  可选：Python 执行（缺失则跳过）');
try {
  const r4 = await sandbox.runPython('print(sum(range(1, 101)))');
  log(`python 输出: ${r4.stdout.trim()}`);
} catch {
  log('Python 不可用，跳过（参照实现写死 python3，Windows 上必然 ENOENT）');
}

// ── Demo 4: 工具调用配额与超时 ────────────────────────────────
console.log('\n▶ Demo 4: QuotaTracker + withToolGuards — 配额与超时护栏');
console.log(line);
const quota = new QuotaTracker(3);
const ctx = { quotaKey: 'conv-demo', quota };
for (let i = 1; i <= 4; i++) {
  try {
    await withToolGuards('search_knowledge_base', ctx, async () => `第 ${i} 次调用`);
    log(`[通过] 第 ${i} 次调用（剩余配额 ${quota.remaining('conv-demo')}）`);
  } catch (e) {
    if (e instanceof ToolQuotaError) log(`[拒绝] 第 ${i} 次调用 → ${e.message}`);
  }
}

try {
  await withToolGuards(
    'slow_tool',
    { quotaKey: 'conv-demo-2', quota: new QuotaTracker() },
    (signal) =>
      new Promise((r) => {
        // 真实场景里 signal 会传给 fetch / axios，让底层请求能被真正取消
        signal.addEventListener('abort', () => r('aborted'));
        setTimeout(r, 5_000);
      }),
    300,
  );
} catch (e) {
  if (e instanceof ToolTimeoutError) log(`[超时] ${e.message}`);
}

// ── Demo 5: 多 Agent 权限隔离 ─────────────────────────────────
console.log('\n▶ Demo 5: PermissionPolicy — 多 Agent 权限隔离');
console.log(line);
const policy = new PermissionPolicy();
const checks: Array<{ role: string; resource: any; action: any }> = [
  { role: 'planner', resource: 'tool', action: 'read' },
  { role: 'planner', resource: 'code_execution', action: 'execute' },
  { role: 'researcher', resource: 'network', action: 'read' },
  { role: 'researcher', resource: 'email', action: 'send' },
  { role: 'coder', resource: 'code_execution', action: 'execute' },
  { role: 'coder', resource: 'secret', action: 'read' },
  { role: 'executor', resource: 'tool', action: 'execute' },
  { role: 'reviewer', resource: 'file', action: 'write' },
];
for (const { role, resource, action } of checks) {
  const allowed = policy.check(role, { resource, action });
  log(`${allowed ? '[允许]' : '[拒绝]'} ${role.padEnd(11)} ${resource}:${action}`);
}

console.log('\n' + '='.repeat(72));
console.log('  演示完成。注意：ProcessSandbox 是进程级最小防护，不是真沙箱；');
console.log('  生产环境请用容器级（Docker --network none --read-only）或 gVisor。');
console.log('='.repeat(72));
