import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getAnalysisGraphMermaid,
  getAnalysisSubGraphMermaid,
  getSummarySubGraphMermaid,
} from '../src/llm/graph/requirement-analysis-graph.js';

function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.findIndex(
    (arg) => arg === '-o' || arg === '--output',
  );
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;

  // const mermaidCode = getAnalysisGraphMermaid();
  // const mermaidCode = getAnalysisSubGraphMermaid();
  const mermaidCode = getSummarySubGraphMermaid();

  // 若在交互式终端中直接运行，输出高亮分界和提示信息
  if (process.stdout.isTTY && !outputPath) {
    console.log('\n------------------- Mermaid Graph -------------------');
    console.log(mermaidCode);
    console.log('-----------------------------------------------------\n');
    console.log('💡 提示:');
    console.log(
      '1. 可通过管道重定向保存: npx tsx scripts/print-mermaid.ts > graph.mmd',
    );
    console.log(
      '2. 或指定参数导出文件:   npx tsx scripts/print-mermaid.ts -o graph.mmd\n',
    );
  } else {
    // 管道重定向或保存模式下输出纯净 Mermaid 代码
    console.log(mermaidCode);
  }

  if (outputPath) {
    const fullPath = resolve(process.cwd(), outputPath);
    writeFileSync(fullPath, mermaidCode, 'utf-8');
    console.log(`\n[OK] Mermaid 流程图已成功保存至: ${fullPath}\n`);
  }
}

main();
