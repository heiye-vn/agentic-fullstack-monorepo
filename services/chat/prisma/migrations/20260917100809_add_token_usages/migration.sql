-- CreateTable
CREATE TABLE "token_usages" (
    "id" TEXT NOT NULL,
    "conversationId" VARCHAR(255),
    "messageId" VARCHAR(255),
    "threadId" VARCHAR(255),
    "graphName" VARCHAR(100) NOT NULL,
    "nodeName" VARCHAR(100) NOT NULL,
    "agentName" VARCHAR(100) NOT NULL,
    "modelConfigId" VARCHAR(255),
    "modelName" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'openai',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_usages_conversationId_idx" ON "token_usages"("conversationId");

-- CreateIndex
CREATE INDEX "token_usages_graphName_nodeName_idx" ON "token_usages"("graphName", "nodeName");

-- CreateIndex
CREATE INDEX "token_usages_agentName_idx" ON "token_usages"("agentName");

-- CreateIndex
CREATE INDEX "token_usages_modelConfigId_idx" ON "token_usages"("modelConfigId");

-- CreateIndex
CREATE INDEX "token_usages_createdAt_idx" ON "token_usages"("createdAt");
