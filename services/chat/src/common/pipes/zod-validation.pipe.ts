/**
 * src/common/pipes/zod-validation.pipe.ts
 *
 * 基于 zod 的参数校验管道（第十八章 18.17「对话 DTO 校验」）
 *
 * 为什么不用 Nest 官方那套 `class-validator` + 全局 ValidationPipe：
 * 本项目**没有引入 class-validator**（DTO 是纯类，字段上没有任何装饰器），
 * main.ts 也没有启用全局校验 —— 也就是说 `@Body() dto: XxxDto` 目前
 * **一个字都不校验**，超长输入、错类型、缺失字段都直接进业务逻辑。
 *
 * 与其为此新增一个依赖并全局开启（动静太大、容易误伤存量接口），
 * 不如用仓库里已有的 zod 做一个**按需挂载**的管道：哪个入口要校验，
 * 就在哪个参数上挂。schema 即契约，还能顺手做类型收窄。
 */

import {
  Injectable,
  PipeTransform,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import type { ZodType } from 'zod';

export interface ZodIssue {
  path: string;
  code: string;
  message: string;
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> }): ZodIssue[] {
  return error.issues.map((i) => ({
    path: i.path.map(String).join('.') || '(root)',
    code: i.code,
    message: i.message,
  }));
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // 只回显「哪个字段、违反什么规则」，不回显用户提交的值 ——
    // 校验错误回显原文会变成反射型信息泄露的入口
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: `请求参数校验失败（${metadata.type ?? 'payload'}）`,
      details: formatIssues(result.error),
    });
  }
}
