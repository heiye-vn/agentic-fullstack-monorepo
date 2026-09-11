import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import type { IDocumentParser } from './parsers.types.js';

/**
 * DOCX / DOC 格式文档解析器
 */
@Injectable()
export class DocxParser implements IDocumentParser {
  private readonly logger = new Logger(DocxParser.name);

  /**
   * 解析 DOCX 文件并提取纯文本
   * @param filePath DOCX 物理文件路径
   */
  async parse(filePath: string): Promise<string> {
    try {
      // 兼容 CJS / ESM 默认导出
      const mammothModule = (mammoth as any).default || mammoth;
      const result = await mammothModule.extractRawText({ path: filePath });

      const text = (result && result.value) ? result.value.trim() : '';
      return text;
    } catch (error) {
      this.logger.error(`解析 DOCX 文档失败: ${filePath}`, error);
      throw error;
    }
  }
}
