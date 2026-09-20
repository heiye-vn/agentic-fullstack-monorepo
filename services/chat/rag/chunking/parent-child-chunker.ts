/**
 * parent-child-chunker.ts
 *
 * 第十一章 11.4.7 — Parent-Child 分级切分实现
 *
 * 设计原理：
 * - 解决切分粒度的经典两难困境：
 *   - 小块（如 200 字）：向量语义聚焦，BM25 / 密集向量召回精度极高，但喂给 LLM 会缺失上下文；
 *   - 大块（如 1500 字）：上下文完整，但向量表示容易被稀释，检索阶段难命中。
 * - Parent-Child 策略（检索小块，生成大块）：
 *   - 切分出 Parent 大块与 Child 小块；
 *   - 入库时仅将 children 向量化落库，附带 parentIndex 字段；
 *   - 检索命中 child 后，通过 parentIndex 回查父级大块全文送入 LLM 上下文。
 */

import { chunkText, type Chunk } from './document-chunker.js';

export interface ParentChildChunks {
  /** 大块切分结果，供 LLM 生成阶段获取完整上下文 */
  parents: Chunk[];
  /** 小块切分结果，包含父块索引 parentIndex，供向量检索使用 */
  children: Array<Chunk & { parentIndex: number }>;
}

export interface ParentChildOptions {
  /** 父级大块目标字数（默认 1500） */
  parentSize?: number;
  /** 子级小块目标字数（默认 200） */
  childSize?: number;
}

/**
 * 执行 Parent-Child 双层级文本切分
 *
 * 支持双模式传参：
 * 1. 对象传参: chunkParentChild(text, { parentSize: 300, childSize: 80 })
 * 2. 位置传参: chunkParentChild(text, 1500, 200)
 *
 * @param text 原始输入长文本
 * @param parentSizeOrOptions 父级大块大小 或 选项对象
 * @param childSizeParam 子级小块大小（当第二个参数为 number 时生效）
 * @returns 包含 parents 和 children 的对象
 */
export async function chunkParentChild(
  text: string,
  parentSizeOrOptions: number | ParentChildOptions = 1500,
  childSizeParam = 200,
): Promise<ParentChildChunks> {
  if (!text) {
    return { parents: [], children: [] };
  }

  let parentSize = 1500;
  let childSize = 200;

  if (typeof parentSizeOrOptions === 'number') {
    parentSize = parentSizeOrOptions;
    childSize = childSizeParam;
  } else if (parentSizeOrOptions && typeof parentSizeOrOptions === 'object') {
    if (typeof parentSizeOrOptions.parentSize === 'number') {
      parentSize = parentSizeOrOptions.parentSize;
    }
    if (typeof parentSizeOrOptions.childSize === 'number') {
      childSize = parentSizeOrOptions.childSize;
    }
  }

  const parentOverlap = parentSize > 200 ? 100 : Math.floor(parentSize * 0.2);
  const childOverlap = childSize > 60 ? 30 : Math.floor(childSize * 0.2);

  const parents = await chunkText(text, {
    chunkSize: parentSize,
    chunkOverlap: parentOverlap,
  });

  const children: Array<Chunk & { parentIndex: number }> = [];
  for (const parent of parents) {
    const subChunks = await chunkText(parent.content, {
      chunkSize: childSize,
      chunkOverlap: childOverlap,
    });
    for (const sub of subChunks) {
      children.push({
        ...sub,
        // 子块的 offset 是相对 parent.content 的本地偏移，必须加上 parent 在原文中的
        // 起点才是全局偏移，否则 text.substring(startOffset, endOffset) 还原不出原文
        startOffset: parent.startOffset + sub.startOffset,
        endOffset: parent.startOffset + sub.endOffset,
        parentIndex: parent.index,
      });
    }
  }

  return { parents, children };
}
