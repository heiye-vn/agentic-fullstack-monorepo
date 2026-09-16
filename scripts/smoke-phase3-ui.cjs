/**
 * 验证 UI 操作链路：message 传对象而不是字符串，
 * 期望产出 ui 帧（而不是走对话链的 markdown 帧）。
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:4001';

const envPath = path.resolve(__dirname, '../services/chat/.env');
const secret = fs
  .readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.trim().startsWith('JWT_SECRET='))
  .split('=')
  .slice(1)
  .join('=')
  .trim()
  .replace(/^["']|["']$/g, '');

const token = jwt.sign(
  {
    sub: 'smoke-ui-' + Date.now(),
    username: 'smoke',
    roles: ['user'],
    permissions: [],
  },
  secret,
  { expiresIn: '30m' },
);

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function main() {
  const conv = await (
    await fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: '新对话' }),
    })
  ).json();
  const conversationId = conv.data.id;
  console.log(`conversation = ${conversationId}`);

  const res = await fetch(`${BASE}/api/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      // 前端 AIUIRenderer 回传的 UIAction 形状
      message: {
        componentId: 'select_requirement_type',
        action: 'select',
        data: { selectedType: 'new_feature' },
        timestamp: new Date().toISOString(),
      },
    }),
  });
  console.log(`status=${res.status} content-type=${res.headers.get('content-type')}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames = [];
  const t0 = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!raw.startsWith('data: ')) continue;
      try {
        const f = JSON.parse(raw.slice(6));
        frames.push(f);
        const p =
          f.messageType === 'ui'
            ? `组件数=${f.payload.components?.length ?? 0} thinking=${JSON.stringify(f.payload.thinking)}`
            : JSON.stringify(f.payload);
        console.log(`  [+${Date.now() - t0}ms] ${f.messageType} ${String(p).slice(0, 160)}`);
      } catch {}
    }
  }

  const types = frames.map((f) => f.messageType);
  console.log(`\n帧序列: ${types.join(' → ')}`);
  console.log(`产出 ui 帧: ${types.includes('ui')}`);
  console.log(`收尾 done : ${types.includes('done')}`);
  console.log(`出现 error: ${types.includes('error')}`);
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
