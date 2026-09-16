import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ArtifactService } from './artifact.service.js';
import { ConversationService } from '../conversation/conversation.service.js';
import {
  UpdateArtifactDto,
  UpdateTitleDto,
  OptimizeArtifactDto,
} from './dto/index.js';

@Controller('api/artifacts')
@UseGuards(JwtAuthGuard)
export class ArtifactController {
  constructor(
    private readonly artifactService: ArtifactService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * GET /api/artifacts/conversation/:conversationId
   * 按会话取产物（权限通过会话归属校验）
   */
  @Get('conversation/:conversationId')
  async getByConversation(
    @Param('conversationId') conversationId: string,
    @CurrentUser('userId') userId: string,
  ) {
    await this.conversationService.findById(conversationId, userId);
    return this.artifactService.findByConversation(conversationId);
  }

  /**
   * GET /api/artifacts/:id
   */
  @Get(':id')
  async getArtifact(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);
    return artifact;
  }

  /**
   * PUT /api/artifacts/:id
   * 人工编辑产物内容
   */
  @Put(':id')
  async updateArtifact(
    @Param('id') id: string,
    @Body() dto: UpdateArtifactDto,
    @CurrentUser('userId') userId: string,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);
    return this.artifactService.updateArtifact(id, dto.content, dto.changelog);
  }

  /**
   * PATCH /api/artifacts/:id/title
   */
  @Patch(':id/title')
  async updateTitle(
    @Param('id') id: string,
    @Body() dto: UpdateTitleDto,
    @CurrentUser('userId') userId: string,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);
    return this.artifactService.updateTitle(id, dto.title);
  }

  /**
   * POST /api/artifacts/:id/optimize
   * 流式 AI 优化（SSE）
   */
  @Post(':id/optimize')
  async optimizeArtifact(
    @Param('id') id: string,
    @Body() dto: OptimizeArtifactDto,
    @CurrentUser('userId') userId: string,
    @Res() res: Response,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);

    return this.artifactService.optimizeArtifactStream(id, dto.instruction, res);
  }

  /**
   * GET /api/artifacts/:id/versions
   */
  @Get(':id/versions')
  async getVersions(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);
    return this.artifactService.getVersions(id);
  }

  /**
   * POST /api/artifacts/:id/revert/:version
   */
  @Post(':id/revert/:version')
  async revertToVersion(
    @Param('id') id: string,
    @Param('version') version: string,
    @CurrentUser('userId') userId: string,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);
    return this.artifactService.revertToVersion(id, parseInt(version, 10));
  }

  /**
   * DELETE /api/artifacts/:id
   */
  @Delete(':id')
  async deleteArtifact(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    const artifact = await this.artifactService.findById(id);
    await this.conversationService.findById(artifact.conversationId, userId);
    await this.artifactService.deleteArtifact(id);
    return { success: true };
  }
}
