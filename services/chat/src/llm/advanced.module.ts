import { Module } from '@nestjs/common';
import {
  AdvancedController,
  MemoryController,
  FilesystemController,
  EmbeddingController,
  AgentsController,
} from './advanced.controller.js';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { EmbeddingService } from './embedding/embedding.service.js';
import { VectorStoreService } from './embedding/vector-store.service.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { OrchestratorService } from './agents/orchestrator.service.js';

@Module({
  controllers: [
    AdvancedController,
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
  ],
  providers: [
    RunnableMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
  exports: [
    RunnableMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
})
export class AdvancedModule {}
