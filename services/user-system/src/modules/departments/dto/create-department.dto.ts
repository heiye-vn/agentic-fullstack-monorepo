import { IsNotEmpty, IsString, IsOptional, IsEnum, IsInt } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty({ message: '部门名称不能为空' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: '部门编码不能为空' })
  code!: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  leader?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
