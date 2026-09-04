import { IsNotEmpty, IsString, IsOptional, IsEnum, IsInt } from 'class-validator';
import { CommonStatus, PermissionType } from '@prisma/client';

export class CreatePermissionDto {
  @IsString()
  @IsNotEmpty({ message: '权限名称不能为空' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: '权限标识编码不能为空' })
  code!: string;

  @IsEnum(PermissionType, { message: '权限类型无效 (CATALOG, MENU, BUTTON, API)' })
  type!: PermissionType;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  component?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
