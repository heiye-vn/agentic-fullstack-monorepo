import { IsOptional, IsString, IsEmail, IsEnum } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  realName?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
