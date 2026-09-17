import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ModelConfigService } from './model-config.service.js';
import { ModelType } from '../prisma/index.js';
import {
  CreateModelConfigDto,
  UpdateModelConfigDto,
} from './dto/index.js';

@Controller('api/models')
@UseGuards(JwtAuthGuard)
export class ModelConfigController {
  constructor(private readonly modelConfigService: ModelConfigService) {}

  /**
   * GET /api/models/available
   * 获取当前用户可用的 general 模型列表（前端模型选择器用）。
   * 返回数据按 private → public 分组，每组内按 isDefault → priority 排序。
   */
  @Get('available')
  async findAvailable(@CurrentUser('userId') userId: string) {
    return this.modelConfigService.findAvailableGeneralModels(userId);
  }

  /**
   * GET /api/models/default/:type
   * 获取某类型的默认模型（未传 modelId 时兜底用）。私人默认优先，再公开默认。
   */
  @Get('default/:type')
  async findDefault(
    @CurrentUser('userId') userId: string,
    @Param('type') type: ModelType,
  ) {
    return this.modelConfigService.findDefaultByTypeForUser(type, userId);
  }

  /**
   * GET /api/models/admin
   * 管理后台：获取所有模型配置
   */
  @Get('admin')
  async findAll() {
    return this.modelConfigService.findAll();
  }

  /**
   * GET /api/models/:id
   * 管理后台：按 ID 获取单个模型
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.modelConfigService.findByIdSafe(id);
  }

  /**
   * POST /api/models
   * 管理后台：创建模型配置
   */
  @Post()
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateModelConfigDto,
  ) {
    return this.modelConfigService.create(dto, userId);
  }

  /**
   * PUT /api/models/:id
   * 管理后台：更新模型配置
   */
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateModelConfigDto) {
    return this.modelConfigService.update(id, dto);
  }

  /**
   * DELETE /api/models/:id
   * 管理后台：删除模型配置
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.modelConfigService.delete(id);
  }
}
