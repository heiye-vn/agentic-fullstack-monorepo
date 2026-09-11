import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller.js';
import { SearchController } from './search.controller.js';
import { DocumentService } from './document.service.js';
import { ChunkService } from './chunk.service.js';
import { EmbeddingService } from './embedding.service.js';
import { SearchService } from './search.service.js';
import { TextParser } from './parsers/text.parser.js';
import { PdfParser } from './parsers/pdf.parser.js';
import { DocxParser } from './parsers/docx.parser.js';
import { ParserFactory } from './parsers/parser.factory.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdvancedModule } from '../llm/advanced.module.js';
import { SseModule } from '../sse/sse.module.js';

@Module({
  imports: [PrismaModule, AdvancedModule, SseModule],
  controllers: [DocumentController, SearchController],
  providers: [
    TextParser,
    PdfParser,
    DocxParser,
    ParserFactory,
    EmbeddingService,
    ChunkService,
    SearchService,
    DocumentService,
  ],
  exports: [
    DocumentService,
    ChunkService,
    EmbeddingService,
    SearchService,
    ParserFactory,
  ],
})
export class DocumentModule {}
