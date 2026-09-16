import { IsOptional, IsString, IsEnum, IsInt } from 'class-validator';
import { CommonStatus } from '../../../generated/prisma/client.js';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

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
