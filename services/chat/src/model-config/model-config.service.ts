import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, ModelType, ModelVisibility } from '../prisma/index.js';
import type { ModelConfig } from '../prisma/index.js';
import type {
  CreateModelConfigDto,
  UpdateModelConfigDto,
} from './dto/index.js';

/**
 * 模型选择器返回的精简字段（不含 apiKey / baseUrl 等敏感配置）
 */
export type AvailableModelItem = Pick<
  ModelConfig,
  | 'id'
  | 'name'
  | 'model'
  | 'provider'
  | 'type'
  | 'priority'
  | 'isDefault'
  | 'visibility'
  | 'capabilities'
  | 'metadata'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * 模型配置服务
 *
 * 设计要点：
 * - 私人模型（createdBy = userId）优先于公开模型（visibility = public）
 * - 同一 type 下只有一个 isDefault，创建/更新时会把旧的默认取消掉
 * - apiKey 允许留在库里作为明文兜底，但业务层优先走 process.env（见 getApiKeys）
 */
@Injectable()
export class ModelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 根据 ID 获取单个模型配置
   */
  async findById(id: string): Promise<ModelConfig> {
    const config = await this.prisma.modelConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException(`模型配置不存在: ${id}`);
    return config;
  }

  /**
   * 获取指定类型的所有激活模型（私人优先 → 公开，每组按 priority 降序）
   */
  async findByType(type: ModelType, userId?: string): Promise<ModelConfig[]> {
    const privateModels = await this.prisma.modelConfig.findMany({
      where: { type, isActive: true, createdBy: userId },
      orderBy: { priority: 'desc' },
    });
    const publicModels = await this.prisma.modelConfig.findMany({
      where: { type, isActive: true, visibility: ModelVisibility.public },
      orderBy: { priority: 'desc' },
    });
    return [...privateModels, ...publicModels];
  }

  /**
   * 获取某类型的默认模型（不区分用户）
   */
  async findDefaultByType(type: ModelType): Promise<ModelConfig | null> {
    return this.prisma.modelConfig.findFirst({
      where: { type, isActive: true, isDefault: true },
    });
  }

  /**
   * 获取当前用户可用的 general 模型列表（前端模型选择器用）。
   * 私人模型排在公开模型之前，每组内部按 isDefault → priority 排序。
   */
  async findAvailableGeneralModels(
    userId: string,
  ): Promise<AvailableModelItem[]> {
    const select = {
      id: true,
      name: true,
      model: true,
      provider: true,
      type: true,
      priority: true,
      isDefault: true,
      visibility: true,
      // capabilities：模型的感知能力标签（text/vision/voice/speech/code/reasoning/image/embedding）
      // 用于后期对接不同类型模型时过滤可用模型
      capabilities: true,
      metadata: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    const [privateModels, publicModels] = await Promise.all([
      this.prisma.modelConfig.findMany({
        where: { type: ModelType.general, isActive: true, createdBy: userId },
        orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }],
        select,
      }),
      this.prisma.modelConfig.findMany({
        where: {
          type: ModelType.general,
          isActive: true,
          visibility: ModelVisibility.public,
        },
        orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }],
        select,
      }),
    ]);

    return [...privateModels, ...publicModels];
  }

  /**
   * 获取某类型的默认模型（私人优先，再公开）——未传 modelId 时的兜底选择
   */
  async findDefaultByTypeForUser(
    type: ModelType,
    userId: string,
  ): Promise<ModelConfig | null> {
    const privateDefault = await this.prisma.modelConfig.findFirst({
      where: { type, isActive: true, isDefault: true, createdBy: userId },
    });
    if (privateDefault) return privateDefault;

    return this.prisma.modelConfig.findFirst({
      where: {
        type,
        isActive: true,
        isDefault: true,
        visibility: ModelVisibility.public,
      },
    });
  }

  /**
   * 获取单个模型配置（供 Orchestrator 使用）
   */
  async getConfigForOrchestrator(id: string): Promise<ModelConfig> {
    const config = await this.prisma.modelConfig.findUnique({ where: { id } });
    if (!config) {
      throw new NotFoundException(`模型配置不存在: ${id}`);
    }
    return config;
  }

  /**
   * 创建模型配置（设为默认时先摘掉同类型旧的默认）
   */
  async create(
    dto: CreateModelConfigDto,
    createdBy?: string,
  ): Promise<ModelConfig> {
    if (dto.isDefault) {
      await this.prisma.modelConfig.updateMany({
        where: { type: dto.type ?? ModelType.general, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.modelConfig.create({
      data: {
        name: dto.name,
        provider: dto.provider ?? 'openai',
        model: dto.model,
        type: dto.type ?? ModelType.general,
        priority: dto.priority ?? 0,
        baseUrl: dto.baseUrl,
        apiKey: dto.apiKey,
        metadata: dto.metadata
          ? (dto.metadata as Prisma.InputJsonValue)
          : undefined,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        visibility: dto.visibility ?? ModelVisibility.public,
        createdBy,
        // capabilities：模型的感知能力标签，默认为 ["text"]
        capabilities: dto.capabilities ?? ['text'],
      },
    });
  }

  /**
   * 更新模型配置（只更新显式传入的字段）
   */
  async update(
    id: string,
    dto: UpdateModelConfigDto,
  ): Promise<ModelConfig> {
    const existing = await this.findById(id);

    if (dto.isDefault) {
      await this.prisma.modelConfig.updateMany({
        where: { type: existing.type, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return this.prisma.modelConfig.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.provider !== undefined && { provider: dto.provider }),
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.baseUrl !== undefined && { baseUrl: dto.baseUrl }),
        ...(dto.apiKey !== undefined && { apiKey: dto.apiKey }),
        ...(dto.metadata !== undefined && {
          metadata: dto.metadata as Prisma.InputJsonValue,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.capabilities !== undefined && {
          capabilities: dto.capabilities,
        }),
      },
    });
  }

  /**
   * 删除模型配置
   */
  async delete(id: string): Promise<ModelConfig> {
    await this.findById(id);
    return this.prisma.modelConfig.delete({ where: { id } });
  }

  /**
   * 获取所有模型配置（管理后台用）
   */
  async findAll(): Promise<ModelConfig[]> {
    return this.prisma.modelConfig.findMany({
      orderBy: [{ type: 'asc' }, { priority: 'desc' }],
    });
  }
}
