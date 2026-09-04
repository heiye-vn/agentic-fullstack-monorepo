import { IsOptional, IsString, IsEnum, IsInt } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

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
