/**
 * services/chat/src/security/sandbox.ts
 *
 * 进程级代码执行沙箱（第十八章 18.10）
 *
 * 沙箱关注的不是"证明 Agent 永远不会犯错"，而是**损害半径控制（Blast Radius）**：
 * 即使 Agent 执行了错误或被注入的代码，影响也应被限制在一个临时目录、一个
 * 受限子进程之内，而不是整个宿主机。
 *
 * 三层防护：
 *   1. PathValidator     —— 文件路径白名单，禁止越界访问
 *   2. EnvironmentFilter —— 环境变量过滤，只传最小集合给子进程
 *   3. ProcessSandbox    —— 受限子进程执行（限 cwd、env、timeout、maxBuffer、命令白名单）
 *
 * ⚠️ 诚实声明（文档 18.10.5）：这是**进程级的最小防护，不是真沙箱**。
 * 它只在应用层拦截——沙箱内代码若直接 `fs.readFileSync('/proc/cpuinfo')`，
 * PathValidator 拦不住。生产要用容器级（Docker `--network none --read-only`）
 * 或微虚拟机级（gVisor / Firecracker）隔离。
 *
 * 参照实现（autix）的三个坑，这里都改掉了，见各处注释：
 *   1. `require('path')` 在 ESM 项目里直接崩
 *   2. `root + '/'` 的前缀判断在 Windows 上恒不匹配（分隔符是 `\`）
 *   3. 输出超限被误报成 TimeoutError
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { basename, resolve, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

// ─────────────────────── PathValidator ───────────────────────

export class PathEscapeError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly allowedRoot: string,
  ) {
    super(`路径越界：${attemptedPath} 不在允许的根目录 ${allowedRoot} 内`);
    this.name = 'PathEscapeError';
  }
}

/** Windows 文件系统大小写不敏感，比较前要统一；posix 则区分大小写 */
function normalizeCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * 判断 resolved 是否落在 root 之内（含 root 自身）。
 *
 * 边界必须是分隔符：`/tmp/docs` 不能放行 `/tmp/docs-evil`。
 * 分隔符用 `path.sep` 而不是硬编码 '/'。
 */
function isWithinRoot(resolved: string, root: string): boolean {
  const r = normalizeCase(root);
  const t = normalizeCase(resolved);
  if (t === r) return true;
  const base = r.endsWith(sep) ? r : r + sep;
  // 根目录本身（'/' 或 'C:\'）已经是分隔符结尾，本身即全包含
  return t.startsWith(base);
}

/**
 * 文件路径沙箱校验器。
 * 阻止 Agent 访问允许目录之外的文件——即使它使用 `..`、符号链接、绝对路径等手段。
 */
export class PathValidator {
  private readonly roots: string[];
  private readonly resolveSymlinks: boolean;

  /**
   * @param allowedRoots 允许的根目录（构造时即 resolve，相对路径按 cwd 解析）
   * @param opts.resolveSymlinks 是否把符号链接解析成真实路径后再判定。
   *   默认 **true** —— 参照实现声称 resolve 能"消除软链接"，其实不能，
   *   `path.resolve()` 只做字符串规范化，不碰文件系统。开着这一项才能真正挡住
   *   "在沙箱内建一个指向 /etc 的软链接再从软链接读"。
   *   代价是每次校验一次 stat，路径不存在时回退到纯 resolve。
   */
  constructor(allowedRoots: string[], opts: { resolveSymlinks?: boolean } = {}) {
    if (!allowedRoots.length) {
      // 空白名单 = 任何路径都不合法。宁可让调用方显式传根目录，也不要静默放行
      throw new Error('PathValidator 至少需要指定一个 allowedRoot');
    }
    this.resolveSymlinks = opts.resolveSymlinks ?? true;
    this.roots = allowedRoots.map((r) => resolve(r));
  }

  /** 列出当前允许的根目录（已 resolve） */
  get allowedRoots(): string[] {
    return [...this.roots];
  }

  private normalize(targetPath: string): string {
    const resolved = resolve(targetPath);
    if (!this.resolveSymlinks) return resolved;
    try {
      // 只对已存在的部分做 realpath；不存在的文件直接返回 resolve 结果
      return existsSync(resolved) ? realpathSync(resolved) : resolved;
    } catch {
      return resolved;
    }
  }

  /** 校验路径是否在允许的根目录内，越界抛 PathEscapeError */
  validate(targetPath: string): void {
    const resolved = this.normalize(targetPath);
    if (!this.roots.some((root) => isWithinRoot(resolved, root))) {
      throw new PathEscapeError(targetPath, this.roots.join(', '));
    }
  }

  /** 静默判定（不抛错），供 UI / 预检使用 */
  isAllowed(targetPath: string): boolean {
    try {
      this.validate(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  /** 批量校验，任何一个路径越界即抛出 */
  validateAll(paths: string[]): void {
    for (const p of paths) this.validate(p);
  }
}

// ─────────────────────── EnvironmentFilter ───────────────────────

/** 敏感环境变量的关键词黑名单（不区分大小写） */
const SENSITIVE_ENV_PATTERNS = [
  'key',
  'secret',
  'token',
  'password',
  'credential',
  'auth',
  'private',
  'apikey',
  'api_key',
  'database_url',
  'db_url',
  'connection_string',
];

/**
 * 无论如何都要保留的基线变量。
 *
 * 比参照实现多了一组 Windows 必备项：不加 `SystemRoot` / `COMSPEC` / `PATHEXT`
 * 的话，Windows 上 spawn 出来的子进程（尤其是 .cmd/.bat 包装的可执行文件）会直接失败。
 */
const BASE_ALLOWED_ENV = [
  'PATH',
  'HOME',
  'LANG',
  'TERM',
  'TZ',
  // Windows 必需
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
];

/**
 * 环境变量过滤器。
 *
 * 策略：命中敏感关键词的一律丢弃；其余默认保留，
 * 只有显式加进 `allow` 的敏感变量才会被放行。
 */
export class EnvironmentFilter {
  private readonly patterns: string[];

  constructor(additionalPatterns?: string[]) {
    this.patterns = [...SENSITIVE_ENV_PATTERNS, ...(additionalPatterns ?? [])];
  }

  /** 检查某个环境变量名是否疑似敏感 */
  isSensitive(name: string): boolean {
    const lower = name.toLowerCase();
    return this.patterns.some((p) => lower.includes(p));
  }

  /**
   * 从原始 env 中过滤出安全的子集。
   *
   * @param source 原始环境变量（默认 process.env）
   * @param allow  额外允许的变量名白名单 —— **优先于黑名单**，用于放行
   *                那些名字里带敏感词但确实必须传的变量（如某个 MCP Server
   *                自己要用的 `SERVER_API_KEY`）
   */
  filter(
    source: Record<string, string | undefined> = process.env,
    allow: string[] = [],
  ): Record<string, string> {
    // Windows 上 process.env 的键大小写不固定，白名单比较统一按大写
    const allowSet = new Set(
      [...BASE_ALLOWED_ENV, ...allow].map((k) => k.toUpperCase()),
    );
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(source)) {
      if (val === undefined) continue;
      if (allowSet.has(key.toUpperCase())) {
        result[key] = val;
      } else if (!this.isSensitive(key)) {
        result[key] = val;
      }
    }
    return result;
  }

  /**
   * 严格模式：只保留基线变量 + 显式白名单，其余一律丢弃。
   *
   * 与 `filter()` 的区别：filter 是"黑名单过滤"（默认放行），
   * strict 是"白名单准入"（默认拒绝）。真跑不可信代码时用 strict。
   */
  filterStrict(
    source: Record<string, string | undefined> = process.env,
    allow: string[] = [],
  ): Record<string, string> {
    const allowSet = new Set(
      [...BASE_ALLOWED_ENV, ...allow].map((k) => k.toUpperCase()),
    );
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(source)) {
      if (val === undefined) continue;
      if (allowSet.has(key.toUpperCase())) result[key] = val;
    }
    return result;
  }
}

// ─────────────────────── ProcessSandbox ───────────────────────

export class SandboxTimeoutError extends Error {
  constructor(
    public readonly command: string,
    public readonly timeoutMs: number,
  ) {
    super(`沙箱执行超时：${command}（${timeoutMs}ms）`);
    this.name = 'SandboxTimeoutError';
  }
}

/**
 * 输出超出 maxOutputBytes。
 *
 * 参照实现把这种情况也抛成 `SandboxTimeoutError`，但根本不是超时——
 * 排障时照着"超时"去查会完全查错方向，所以单独拆一个类型。
 */
export class SandboxOutputLimitError extends Error {
  constructor(
    public readonly command: string,
    public readonly maxOutputBytes: number,
  ) {
    super(`沙箱输出超限：${command}（上限 ${maxOutputBytes} 字节）`);
    this.name = 'SandboxOutputLimitError';
  }
}

/** 命令不在白名单内（默认 deny 精神：配了白名单就只跑白名单里的） */
export class SandboxCommandDeniedError extends Error {
  constructor(
    public readonly command: string,
    public readonly allowedCommands: string[],
  ) {
    super(`命令不在沙箱白名单内：${command}（允许：${allowedCommands.join(', ')}）`);
    this.name = 'SandboxCommandDeniedError';
  }
}

export class SandboxExitError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`沙箱执行失败：${command} 退出码 ${exitCode}`);
    this.name = 'SandboxExitError';
  }
}

export interface SandboxConfig {
  /** 工作目录（子进程的 cwd） */
  workDir: string;
  /** 执行超时（ms），默认 10 秒 */
  timeoutMs?: number;
  /** stdout+stderr 合计最大字节数，默认 1MB */
  maxOutputBytes?: number;
  /** 额外允许的环境变量名 */
  allowedEnvVars?: string[];
  /** 额外的环境变量黑名单关键词 */
  sensitivePatterns?: string[];
  /**
   * 允许执行的可执行文件白名单（按 basename 或全路径匹配）。
   * 不传 = 不限制（兼容既有用法）；一旦传入就只放行白名单内的命令。
   */
  allowedCommands?: string[];
  /** 环境变量过滤是否走严格白名单模式，默认 false */
  strictEnv?: boolean;
  /** Python 可执行文件，默认按平台选 `python`(win) / `python3`(posix) */
  pythonBin?: string;
  /**
   * 是否通过 shell 执行命令，**默认 false**。
   *
   * 开 shell 会引入一层命令解释器（Windows 上是 cmd.exe），本身就是额外的注入面；
   * 而且 command 与 args 会被拼成一条命令行再让 shell 去切分，引号处理在
   * Windows 上尤其容易出错。默认关掉：直接 spawn 可执行文件最可控。
   *
   * 只有确实要跑 `.cmd` / `.bat` 包装器（如 npx、tsx）时才显式开，
   * 并且务必同时配 `allowedCommands` 收紧可执行范围。
   */
  shell?: boolean;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  killed: boolean;
  /** 被 kill 的原因：超时 / 输出超限 */
  killReason?: 'timeout' | 'output';
  /** 输出是否因超限被截断 */
  truncated: boolean;
}

/**
 * 进程级代码执行沙箱。
 *
 * 与 `execSync('python3 script.py')` 的区别：
 *   1. 限定 cwd，不能操作任意目录
 *   2. 过滤 env，不继承 API Key 等密钥
 *   3. 加超时，不会无限卡住进程
 *   4. 限输出大小，不会撑爆内存
 *   5. 异步非阻塞，不会阻塞事件循环
 *   6. 可选命令白名单，默认 deny
 */
export class ProcessSandbox {
  private readonly envFilter: EnvironmentFilter;
  private readonly pathValidator: PathValidator;
  readonly config: Required<
    Pick<SandboxConfig, 'workDir' | 'timeoutMs' | 'maxOutputBytes'>
  > &
    SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = {
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
      ...config,
    };
    this.envFilter = new EnvironmentFilter(config.sensitivePatterns);
    this.pathValidator = new PathValidator([config.workDir]);
  }

  private assertCommandAllowed(command: string): void {
    const allow = this.config.allowedCommands;
    if (!allow || allow.length === 0) return;

    // 按 basename 匹配，并容忍平台扩展名：
    // 白名单写 'node' 要能放行 `.../node.exe`（process.execPath 就是全路径）
    const base = basename(command);
    const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
    const ok = allow.some(
      (c) => c === command || c === base || c === stem,
    );
    if (!ok) throw new SandboxCommandDeniedError(command, allow);
  }

  /**
   * 在沙箱中执行命令。
   *
   * @param command 可执行文件
   * @param args    命令参数
   * @param stdin   可选的 stdin 输入（比传临时文件路径更安全）
   */
  execute(command: string, args: string[] = [], stdin?: string): Promise<SandboxResult> {
    this.assertCommandAllowed(command);

    return new Promise<SandboxResult>((resolvePromise, rejectPromise) => {
      const start = Date.now();
      const safeEnv = this.config.strictEnv
        ? this.envFilter.filterStrict(process.env, this.config.allowedEnvVars)
        : this.envFilter.filter(process.env, this.config.allowedEnvVars);

      const opts: SpawnOptions = {
        cwd: this.config.workDir,
        env: safeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        // 默认不起 shell（见 SandboxConfig.shell 注释）
        shell: this.config.shell ?? false,
        windowsHide: true,
      };

      const child = spawn(command, args, opts);

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let killReason: 'timeout' | 'output' | undefined;
      const maxBytes = this.config.maxOutputBytes;
      const label = `${command} ${args.join(' ')}`.trim();

      // 超时自己管，不依赖 spawn 的 timeout 选项：
      // 那个选项在 Windows 上 close 事件的 signal 可能是 null，判不出来是超时还是正常退出
      const timer = setTimeout(() => {
        killReason = 'timeout';
        child.kill();
      }, this.config.timeoutMs);

      const onChunk = (kind: 'stdout' | 'stderr') => (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= maxBytes) {
          if (kind === 'stdout') stdout += chunk.toString();
          else stderr += chunk.toString();
        } else if (!killReason) {
          killReason = 'output';
          child.kill();
        }
      };

      child.stdout?.on('data', onChunk('stdout'));
      child.stderr?.on('data', onChunk('stderr'));

      // 子进程不读 stdin 时写会触发 EPIPE，不接住会让整个进程崩掉
      child.stdin?.on('error', () => {
        /* 忽略：对方不读就算了 */
      });
      if (stdin !== undefined) {
        child.stdin?.write(stdin);
      }
      child.stdin?.end();

      child.on('error', (err) => {
        clearTimeout(timer);
        rejectPromise(err);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;

        if (killReason === 'timeout') {
          rejectPromise(new SandboxTimeoutError(label, this.config.timeoutMs));
          return;
        }
        if (killReason === 'output') {
          rejectPromise(new SandboxOutputLimitError(label, maxBytes));
          return;
        }

        resolvePromise({
          stdout,
          stderr,
          exitCode: code ?? (signal ? 1 : 0),
          durationMs,
          killed: killReason !== undefined,
          killReason,
          truncated: outputBytes > maxBytes,
        });
      });
    });
  }

  /**
   * 在沙箱中运行 Python 代码（通过 stdin 传入，不写临时文件）。
   *
   * 可执行文件名按平台选：Windows 上是 `python`，posix 上是 `python3`。
   * 参照实现写死 `python3`，在 Windows 上必然 ENOENT。
   */
  async runPython(code: string): Promise<SandboxResult> {
    const bin =
      this.config.pythonBin ??
      (process.platform === 'win32' ? 'python' : 'python3');
    return this.execute(bin, ['-c', code]);
  }

  /**
   * 在沙箱中运行 Node.js 代码。
   *
   * 用 `process.execPath` 而不是 PATH 上的 `node` —— 保证子进程与父进程
   * 是同一个 Node 版本，避免版本漂移导致的诡异行为（本项目正是多版本共存的环境）。
   */
  async runNode(code: string): Promise<SandboxResult> {
    return this.execute(process.execPath, ['-e', code]);
  }

  /** 校验路径是否在沙箱 workDir 内 */
  validatePath(targetPath: string): void {
    this.pathValidator.validate(targetPath);
  }

  /** 静默判定路径是否可访问 */
  isPathAllowed(targetPath: string): boolean {
    return this.pathValidator.isAllowed(targetPath);
  }
}
