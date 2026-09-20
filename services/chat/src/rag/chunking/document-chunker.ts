/**
 * document-chunker.ts
 *
 * 第十一章 11.4 — 文档切分纯函数模块
 *
 * 设计目标：
 * - 零外部依赖（除 @langchain/textsplitters 外，不引入 jieba / spaCy 等重型 NLP 依赖）
 * - 显式声明中文全角标点分隔符，确保分块截断优先落在段落换行与标点符号处，避免在词语中间被机械切断
 * - 精确计算 startOffset 与 endOffset，确保 text.substring(startOffset, endOffset) === content
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export interface Chunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_CHUNK_OVERLAP = 50;
export const DEFAULT_SEPARATORS = [
  '\n\n',
  '\n',
  '。',
  '！',
  '？',
  '；',
  '，',
  ' ',
  '',
];

/**
 * 将文本切分为带有精确起止偏移量的 Chunk 数组
 *
 * @param text 待切分长文本
 * @param options 切分参数配置
 * @returns 切分后的 Chunk 列表
 */
export async function chunkText(
  text: string,
  options: ChunkOptions = {},
): Promise<Chunk[]> {
  if (!text) {
    return [];
  }

  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    chunkOverlap = DEFAULT_CHUNK_OVERLAP,
    separators = DEFAULT_SEPARATORS,
  } = options;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators,
  });

  const pieces = await splitter.splitText(text);

  let cursor = 0;
  return pieces.map((content, index) => {
    let startOffset = text.indexOf(content, cursor);
    if (startOffset === -1) {
      // 容错搜索：当 overlap 或标点截断导致光标位置略超前时向前回溯
      startOffset = text.indexOf(content, Math.max(0, cursor - chunkOverlap * 2));
      if (startOffset === -1) {
        startOffset = text.indexOf(content);
      }
    }
    const endOffset = startOffset + content.length;
    cursor = Math.max(0, endOffset - chunkOverlap);

    return {
      index,
      content,
      startOffset,
      endOffset,
    };
  });
}
