import { IsNotEmpty, IsString, IsOptional, IsEnum, IsInt } from 'class-validator';
import { CommonStatus } from '../../../generated/prisma/client.js';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: '角色编码不能为空' })
  code!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
