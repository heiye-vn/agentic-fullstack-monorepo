import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { ArtifactType } from '../prisma/index.js';
import type { Artifact, ArtifactVersion } from '../prisma/index.js';
import { createChatModel } from '../llm/model.factory.js';

/**
 * 产物（Artifact）服务
 *
 * 产物与消息里的「正文」是两回事：消息是对话流水，产物是这段对话沉淀下来的
 * 那份可编辑文档（Markdown / 代码 / 表格…），一个会话最多一个产物，
 * 每次 AI 重生成或人工编辑都追加一条版本记录，因此天然支持回溯与回滚。
 */
@Injectable()
export class ArtifactService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建或更新产物（AI 生成时调用）
   * - 已存在 → 版本号 +1，追加版本记录
   * - 不存在 → 创建产物并写入 v1
   * - 两种情况都用事务同步更新会话标题，让侧边栏显示产物标题
   */
  async upsertArtifact(data: {
    conversationId: string;
    userId: string;
    title: string;
    type: ArtifactType;
    content: string;
    sourceMessageId?: string;
  }): Promise<Artifact> {
    const existing = await this.prisma.artifact.findUnique({
      where: { conversationId: data.conversationId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (existing) {
      const newVersion = existing.currentVersion + 1;
      const { sourceMessageId, ...artifactData } = data;

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.artifact.update({
          where: { id: existing.id },
          data: {
            title: artifactData.title,
            content: artifactData.content,
            currentVersion: newVersion,
            versions: {
              create: {
                version: newVersion,
                content: artifactData.content,
                sourcetags: ['AI'],
                sourceMessageId,
              },
            },
          },
        });

        await tx.conversation.update({
          where: { id: data.conversationId },
          data: { title: data.title },
        });

        return updated;
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // sourceMessageId 只属于 ArtifactVersion，需要从 artifact.create 的 data 中剔除
      const { sourceMessageId, ...artifactData } = data;

      const artifact = await tx.artifact.create({
        data: {
          ...artifactData,
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              content: data.content,
              sourcetags: ['AI'],
              sourceMessageId,
            },
          },
        },
        include: { versions: true },
      });

      await tx.conversation.update({
        where: { id: data.conversationId },
        data: { title: data.title },
      });

      return artifact;
    });
  }

  /**
   * 使用 LLM 生成产物标题（10-20 字）
   * 模型与密钥统一走 createChatModel（YAML 配置 + process.env），禁止业务层直连 SDK
   */
  async generateTitle(summaryContent: string): Promise<string> {
    const prompt = `请为以下需求分析报告生成一个简洁的标题（10-20字）：

${summaryContent.substring(0, 500)}

只返回标题文本，不要其他内容。`;

    const model = createChatModel({
      temperature: 0.7,
      maxTokens: 100,
    });
    const response = await model.invoke(prompt);

    return response.content
      .toString()
      .trim()
      .replace(/^["']|["']$/g, '');
  }

  /**
   * 更新产物标题（同时同步会话标题）
   */
  async updateTitle(artifactId: string, title: string): Promise<Artifact> {
    const artifact = await this.prisma.artifact.findUniqueOrThrow({
      where: { id: artifactId },
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.artifact.update({
        where: { id: artifactId },
        data: { title },
      });

      await tx.conversation.update({
        where: { id: artifact.conversationId },
        data: { title },
      });

      return updated;
    });
  }

  /**
   * 用户手动编辑产物：追加版本，来源标记补上 HUMAN
   */
  async updateArtifact(
    artifactId: string,
    content: string,
    changelog?: string,
  ): Promise<Artifact> {
    const artifact = await this.prisma.artifact.findUniqueOrThrow({
      where: { id: artifactId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    // 从上一个版本继承 sourcetags，并追加 HUMAN
    const lastVersion = artifact.versions[0];
    const inheritedTags = lastVersion?.sourcetags ?? [];
    const newTags = inheritedTags.includes('HUMAN')
      ? inheritedTags
      : [...inheritedTags, 'HUMAN'];

    const newVersion = artifact.currentVersion + 1;

    return this.prisma.artifact.update({
      where: { id: artifactId },
      data: {
        content,
        currentVersion: newVersion,
        versions: {
          create: {
            version: newVersion,
            content,
            changelog,
            sourcetags: newTags,
          },
        },
      },
    });
  }

  /**
   * 流式 AI 优化（SSE，直接把帧写进 res）
   * 事件协议：{ type: 'markdown', content } / { type: 'done', version } / { type: 'error', message }
   */
  async optimizeArtifactStream(
    artifactId: string,
    instruction: string,
    res: Response,
  ): Promise<void> {
    const artifact = await this.prisma.artifact.findUniqueOrThrow({
      where: { id: artifactId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    const lastVersion = artifact.versions[0];
    const originalContent = artifact.content;
    const inheritedTags = lastVersion?.sourcetags ?? ['AI'];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const optimizeAgent = createChatModel({
        temperature: 0.7,
        maxTokens: 4096,
        streaming: true,
      });

      const systemPrompt = `你是一个专业的文档优化助手。

用户优化需求：${instruction}

原始文档内容：
\`\`\`markdown
${originalContent}
\`\`\`

请根据用户需求优化文档，要求：
1. 保持文档的整体结构和格式
2. 只针对用户提出的问题进行改进
3. 不要删除重要信息
4. 保持 Markdown 标题层级和代码块格式
5. 直接返回优化后的完整文档，不要额外解释`;

      let accumulatedContent = '';

      const stream = await optimizeAgent.stream(systemPrompt);

      for await (const chunk of stream) {
        const content = chunk.content.toString();
        accumulatedContent += content;

        res.write(
          `data: ${JSON.stringify({ type: 'markdown', content })}\n\n`,
        );
      }

      // 落库为新版本
      const newVersion = artifact.currentVersion + 1;
      await this.prisma.artifact.update({
        where: { id: artifactId },
        data: {
          content: accumulatedContent,
          currentVersion: newVersion,
          versions: {
            create: {
              version: newVersion,
              content: accumulatedContent,
              changelog: `AI优化：${instruction}`,
              sourcetags: inheritedTags,
            },
          },
        },
      });

      res.write(`data: ${JSON.stringify({ type: 'done', version: newVersion })}\n\n`);
      res.end();
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`,
      );
      res.end();
    }
  }

  /**
   * 获取版本历史（倒序）
   */
  async getVersions(artifactId: string): Promise<ArtifactVersion[]> {
    return this.prisma.artifactVersion.findMany({
      where: { artifactId },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * 回滚到指定版本（不是覆盖，而是把旧内容作为新版本追加，保留完整时间线）
   */
  async revertToVersion(
    artifactId: string,
    targetVersion: number,
  ): Promise<Artifact> {
    const version = await this.prisma.artifactVersion.findUniqueOrThrow({
      where: { artifactId_version: { artifactId, version: targetVersion } },
    });

    const artifact = await this.prisma.artifact.findUniqueOrThrow({
      where: { id: artifactId },
    });

    const inheritedTags = version.sourcetags ?? [];
    const newTags = inheritedTags.includes('HUMAN')
      ? inheritedTags
      : [...inheritedTags, 'HUMAN'];

    const newVersion = artifact.currentVersion + 1;

    return this.prisma.artifact.update({
      where: { id: artifactId },
      data: {
        content: version.content,
        currentVersion: newVersion,
        versions: {
          create: {
            version: newVersion,
            content: version.content,
            changelog: `恢复到版本 ${targetVersion}`,
            sourcetags: newTags,
          },
        },
      },
      include: { versions: true },
    });
  }

  /**
   * 按会话查产物（只带最近 10 个版本，避免响应过大）
   */
  async findByConversation(
    conversationId: string,
  ): Promise<Artifact | null> {
    return this.prisma.artifact.findUnique({
      where: { conversationId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * 按 ID 查产物
   */
  async findById(artifactId: string): Promise<Artifact> {
    return this.prisma.artifact.findUniqueOrThrow({
      where: { id: artifactId },
    });
  }

  /**
   * 删除产物（级联删除版本记录）
   */
  async deleteArtifact(artifactId: string): Promise<void> {
    await this.prisma.artifact.delete({
      where: { id: artifactId },
    });
  }
}
