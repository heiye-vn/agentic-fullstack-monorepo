import * as path from 'node:path';
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { TextParser } from './text.parser.js';
import { PdfParser } from './pdf.parser.js';
import { DocxParser } from './docx.parser.js';
import type { IDocumentParser } from './parsers.types.js';

// 支持的 MIME 类型与解析器映射关系
export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
];

export const PDF_MIME_TYPES = [
  'application/pdf',
];

export const DOCX_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

@Injectable()
export class ParserFactory {
  private readonly logger = new Logger(ParserFactory.name);

  constructor(
    private readonly textParser: TextParser,
    private readonly pdfParser: PdfParser,
    private readonly docxParser: DocxParser,
  ) {}

  /**
   * 根据 MIME 类型（结合扩展名容错）获取对应的解析器
   * @param filePath 文件物理路径
   * @param mimeType 文件的 MIME 类型
   */
  getParser(filePath: string, mimeType?: string): IDocumentParser {
    const ext = path.extname(filePath).toLowerCase();
    const normalizedMime = (mimeType || '').toLowerCase().trim();

    // 1. 优先根据 MIME 类型路由
    if (TEXT_MIME_TYPES.includes(normalizedMime)) {
      return this.textParser;
    }
    if (PDF_MIME_TYPES.includes(normalizedMime)) {
      return this.pdfParser;
    }
    if (DOCX_MIME_TYPES.includes(normalizedMime)) {
      return this.docxParser;
    }

    // 2. 结合扩展名容错路由
    if (['.txt', '.md', '.markdown'].includes(ext)) {
      return this.textParser;
    }
    if (ext === '.pdf') {
      return this.pdfParser;
    }
    if (['.docx', '.doc'].includes(ext)) {
      return this.docxParser;
    }

    // 3. 不支持的类型抛出异常
    this.logger.warn(`未识别的文件类型: MIME=${mimeType}, Ext=${ext}, Path=${filePath}`);
    throw new BadRequestException(
      `不支持的文件解析类型: ${mimeType || ext || '未知'}，目前仅支持 TXT、MD、PDF、DOCX 格式`,
    );
  }

  /**
   * 按照 MIME 类型路由解析文件并提取纯文本
   * @param filePath 物理文件路径
   * @param mimeType 文件 MIME 类型
   */
  async extractText(filePath: string, mimeType?: string): Promise<string> {
    const parser = this.getParser(filePath, mimeType);
    return parser.parse(filePath);
  }
}
