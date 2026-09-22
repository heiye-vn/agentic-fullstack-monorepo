import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, ModelType, ModelVisibility } from '../prisma/index.js';
import type { ModelConfig } from '../prisma/index.js';
import type {
  CreateModelConfigDto,
  UpdateModelConfigDto,
} from './dto/index.js';
import { encryptSecret, decryptSecret } from '../common/crypto/secret-crypto.js';
import { redactApiKey, redactApiKeys } from '../security/mask.js';

/**
 * 运行时凭据解析结果
 * keySource 用于前端展示 / 排障：本次调用到底用的哪把钥匙
 */
/**
 * 对外返回时抹掉真实密钥，只保留「是否已配置」。
 *
 * 必须做这件事的原因：库里可能存在升级加密之前写入的**明文** apiKey，
 * 而 findAll / findById 会把整行原样吐给管理接口 —— 等于密钥直接泄露。
 * 新的写入虽然是密文，但一旦 MODEL_CONFIG_SECRET 泄漏，密文同样可读，
 * 所以对外一律不返回真值。
 *
 * 第十八章：这里原先是自己拼 `'***'`，与安全模块的脱敏逻辑是两套口径。
 * 现在复用 `security/mask.ts` 的 `redactApiKey` —— 同一个"对外响应"口径
 * 全项目只有一处定义，改口径不用翻两个文件。
 */

export interface RuntimeCredentials {
  modelName: string;
  /** 解密后的密钥；为空表示走 process.env 兜底 */
  apiKey?: string;
  /** 覆盖用的服务地址；为空表示走 process.env 兜底 */
  baseUrl?: string;
  keySource: 'db' | 'env';
}

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
 * - apiKey 一律加密后入库（见 secret-crypto）；读取时只有 private 模型
 *   才会解密并使用，public 模型永远走 process.env（见 resolveRuntimeCredentials）
 */
@Injectable()
export class ModelConfigService {
  private readonly logger = new Logger(ModelConfigService.name);

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
   * 解析本次调用真正使用的模型与凭据。
   *
   * 策略（方案 C）：
   * - public 模型：忽略库里的 apiKey，一律走 process.env —— 防止任何人
   *   通过「公开模型」把自己的密钥注入到服务端调用链里。
   * - private 模型：库里填了 apiKey 才解密使用；没填则同样回退 env。
   *
   * @throws 模型不存在时向上抛，由调用方决定回退策略
   */
  async resolveRuntimeCredentials(id: string): Promise<RuntimeCredentials> {
    const config = await this.findById(id);

    const isPrivate = config.visibility === ModelVisibility.private;
    const apiKey = isPrivate ? decryptSecret(config.apiKey) : '';
    const baseUrl = isPrivate ? (config.baseUrl ?? '') : '';

    if (!isPrivate && config.apiKey) {
      this.logger.debug(
        `公开模型 [${config.name}] 库内配了 apiKey，已按策略忽略，改用 process.env`,
      );
    }

    return {
      modelName: config.model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      keySource: apiKey ? 'db' : 'env',
    };
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
        apiKey: dto.apiKey ? encryptSecret(dto.apiKey) : undefined,
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
        ...(dto.apiKey !== undefined && {
          apiKey: dto.apiKey ? encryptSecret(dto.apiKey) : null,
        }),
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
   * 注意：apiKey 已脱敏，只返回 hasApiKey 标记
   */
  async findAll(): Promise<
    (ModelConfig & { apiKey: string | null; hasApiKey: boolean })[]
  > {
    const list = await this.prisma.modelConfig.findMany({
      orderBy: [{ type: 'asc' }, { priority: 'desc' }],
    });
    return redactApiKeys(list);
  }

  /**
   * 按 ID 获取单个模型配置（管理后台用，apiKey 已脱敏）
   */
  async findByIdSafe(id: string) {
    return redactApiKey(await this.findById(id));
  }
}
