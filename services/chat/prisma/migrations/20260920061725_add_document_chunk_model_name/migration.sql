-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "modelName" VARCHAR(128) NOT NULL DEFAULT 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

-- CreateIndex
CREATE INDEX "document_chunks_modelName_idx" ON "document_chunks"("modelName");
