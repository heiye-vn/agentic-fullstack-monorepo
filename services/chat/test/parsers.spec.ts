import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextParser } from '../src/document/parsers/text.parser.js';
import { PdfParser } from '../src/document/parsers/pdf.parser.js';
import { DocxParser } from '../src/document/parsers/docx.parser.js';
import { ParserFactory } from '../src/document/parsers/parser.factory.js';

describe('Document Parsers & ParserFactory Unit Tests', () => {
  let textParser: TextParser;
  let pdfParser: PdfParser;
  let docxParser: DocxParser;
  let parserFactory: ParserFactory;

  const testDir = path.resolve(process.cwd(), 'uploads', 'test-parsers-temp');
  const sampleTxtPath = path.join(testDir, 'sample.txt');
  const sampleMdPath = path.join(testDir, 'sample.md');
  const unsupportedPath = path.join(testDir, 'sample.exe');

  beforeAll(async () => {
    await fs.promises.mkdir(testDir, { recursive: true });
    await fs.promises.writeFile(sampleTxtPath, 'Hello Autix Chat! 这是测试纯文本文档。', 'utf-8');
    await fs.promises.writeFile(sampleMdPath, '# Markdown 标题\n\n- 列表项 1\n- 列表项 2', 'utf-8');
    await fs.promises.writeFile(unsupportedPath, 'BINARY_EXE_DATA', 'utf-8');

    textParser = new TextParser();
    pdfParser = new PdfParser();
    docxParser = new DocxParser();
    parserFactory = new ParserFactory(textParser, pdfParser, docxParser);
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    }
  });

  it('TextParser: 应该能成功解析 TXT 文件并返回清理后的文本', async () => {
    const text = await textParser.parse(sampleTxtPath);
    expect(text).toBe('Hello Autix Chat! 这是测试纯文本文档。');
  });

  it('TextParser: 应该能成功解析 Markdown 文件', async () => {
    const text = await textParser.parse(sampleMdPath);
    expect(text).toContain('# Markdown 标题');
    expect(text).toContain('列表项 1');
  });

  it('ParserFactory: 根据 MIME 类型 text/plain 路由到 TextParser', async () => {
    const text = await parserFactory.extractText(sampleTxtPath, 'text/plain');
    expect(text).toBe('Hello Autix Chat! 这是测试纯文本文档。');
  });

  it('ParserFactory: 根据 MIME 类型 text/markdown 路由到 TextParser', async () => {
    const text = await parserFactory.extractText(sampleMdPath, 'text/markdown');
    expect(text).toContain('# Markdown 标题');
  });

  it('ParserFactory: 当 MIME 为空时，应依据扩展名 fallback 路由', async () => {
    const text = await parserFactory.extractText(sampleTxtPath, '');
    expect(text).toBe('Hello Autix Chat! 这是测试纯文本文档。');
  });

  it('ParserFactory: 不支持的文件类型应抛出 BadRequestException', async () => {
    await expect(
      parserFactory.extractText(unsupportedPath, 'application/x-msdownload'),
    ).rejects.toThrow('不支持的文件解析类型');
  });
});
