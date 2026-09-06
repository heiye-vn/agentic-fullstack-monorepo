import { IsOptional, IsString, IsEmail } from 'class-validator';

/**
 * 自助更新个人资料 DTO
 *
 * 注意：普通用户只能修改自己的基本联络信息，
 * 不允许通过该接口触碰 departmentId / status / 角色等敏感字段。
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  realName?: string | null;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  avatar?: string | null;
}
