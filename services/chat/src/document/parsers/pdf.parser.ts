import * as fs from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import * as pdfModule from 'pdf-parse';
import type { IDocumentParser } from './parsers.types.js';

/**
 * PDF 格式文件解析器
 */
@Injectable()
export class PdfParser implements IDocumentParser {
  private readonly logger = new Logger(PdfParser.name);

  /**
   * 解析 PDF 文件并提取纯文本
   * @param filePath PDF 物理文件路径
   */
  async parse(filePath: string): Promise<string> {
    try {
      const dataBuffer = await fs.promises.readFile(filePath);

      // 兼容 pdf-parse 现代版本 (PDFParse 类) 与经典版本 (函数直接调用)
      const PDFParseClass = (pdfModule as any).PDFParse;
      if (PDFParseClass) {
        const parser = new PDFParseClass({ data: dataBuffer });
        const result = await parser.getText();
        if (typeof parser.destroy === 'function') {
          await parser.destroy();
        }
        return result && result.text ? result.text.trim() : '';
      }

      const parseFn = (pdfModule as any).default || pdfModule;
      if (typeof parseFn === 'function') {
        const data = await parseFn(dataBuffer);
        return data && data.text ? data.text.trim() : '';
      }

      throw new Error('未找到可用的 pdf-parse 导出方法');
    } catch (error) {
      this.logger.error(`解析 PDF 文档失败: ${filePath}`, error);
      throw error;
    }
  }
}
