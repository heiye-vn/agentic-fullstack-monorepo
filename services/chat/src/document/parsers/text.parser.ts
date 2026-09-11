import * as fs from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import type { IDocumentParser } from './parsers.types.js';

/**
 * TXT / Markdown 纯文本解析器
 */
@Injectable()
export class TextParser implements IDocumentParser {
  private readonly logger = new Logger(TextParser.name);

  /**
   * 读取并解析 TXT / Markdown 文件
   * @param filePath 文件物理路径
   */
  async parse(filePath: string): Promise<string> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return content.trim();
    } catch (error) {
      this.logger.error(`解析纯文本文件失败: ${filePath}`, error);
      throw error;
    }
  }
}
