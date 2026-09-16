/**
 * Phase 3 SSE 帧协议冒烟测试
 *
 * 不依赖 user-system：直接用 chat 服务的 JWT_SECRET 自签 token，
 * 然后完整跑一遍「创建会话 → 发消息 → 消费 SSE 帧」，验证：
 *   - markdown 帧是 token 级流式（不是一次性吐完）
 *   - log 帧带 RAG 检索信息
 *   - meta 帧带 usedAgents / retrievedDocuments / conversationTitle
 *   - done 帧必定到达（前端靠它收尾）
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:4001';

function loadSecret() {
  const envPath = path.resolve(__dirname, '../services/chat/.env');
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('JWT_SECRET='));
  if (!line) throw new Error('未找到 JWT_SECRET');
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const USER_ID = 'smoke-user-' + Date.now();
const token = jwt.sign(
  { sub: USER_ID, username: 'smoke', roles: ['user'], permissions: [] },
  loadSecret(),
  { expiresIn: '30m' },
);

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

/**
 * 注意：chat 服务有全局 ResponseInterceptor，REST 返回体是
 * {success, code, msg, traceId, data}，真正的业务对象在 data 里。
 * SSE 流不走拦截器，帧体是裸的 {messageType, timestamp, payload}。
 */
async function unwrap(res) {
  const body = await res.json();
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

async function main() {
  console.log(`[setup] userId = ${USER_ID}`);

  // 1. 创建会话
  const createRes = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: '新对话' }),
  });
  const conversation = await unwrap(createRes);
  console.log(`[setup] conversation = ${conversation.id}`);

  // 2. 发起 SSE 对话并逐帧消费
  const start = Date.now();
  const chatRes = await fetch(
    `${BASE}/api/conversations/${conversation.id}/chat`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: process.argv[2] || '你好，请用两句话介绍下你自己。',
      }),
    },
  );

  console.log(
    `[http] status=${chatRes.status} content-type=${chatRes.headers.get('content-type')}`,
  );

  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames = [];
  let firstMarkdownAt = null;
  let lastMarkdownAt = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!raw.startsWith('data: ')) continue;
      let frame;
      try {
        frame = JSON.parse(raw.slice(6));
      } catch {
        continue;
      }
      frames.push(frame);
      const at = Date.now() - start;
      if (frame.messageType === 'markdown') {
        if (firstMarkdownAt === null) firstMarkdownAt = at;
        lastMarkdownAt = at;
      }
      const suffix =
        frame.messageType === 'markdown'
          ? ` content="${JSON.stringify(frame.payload.content)}"`
          : ` payload=${JSON.stringify(frame.payload)}`;
      console.log(`  [+${at}ms] ${frame.messageType}${suffix}`);
    }
  }

  // 3. 断言
  const types = frames.map((f) => f.messageType);
  const markdownCount = types.filter((t) => t === 'markdown').length;
  const meta = frames.find((f) => f.messageType === 'meta');

  console.log('\n===== 校验结果 =====');
  console.log(`帧序列           : ${types.join(' → ')}`);
  console.log(`markdown 帧数    : ${markdownCount}（>1 说明是 token 级流式）`);
  console.log(
    `首个/末个 markdown: ${firstMarkdownAt}ms / ${lastMarkdownAt}ms`,
  );
  console.log(`meta 载荷        : ${JSON.stringify(meta?.payload)}`);
  console.log(`包含 done 帧     : ${types.includes('done')}`);
  console.log(`包含 error 帧    : ${types.includes('error')}`);
  console.log(
    `标题已更新       : ${meta?.payload?.conversationTitle ?? '(无)'}`,
  );

  // 4. 验证消息确实落库了
  const msgRes = await fetch(
    `${BASE}/api/conversations/${conversation.id}/messages`,
    { headers },
  );
  const messages = await unwrap(msgRes);
  const list = Array.isArray(messages) ? messages : [];
  console.log(
    `\n落库消息 ${list.length} 条: ${list
      .map((m) => `${m.role}(${m.content.length}字)`)
      .join(' | ')}`,
  );
}

main().catch((err) => {
  console.error('冒烟测试失败:', err);
  process.exit(1);
});
