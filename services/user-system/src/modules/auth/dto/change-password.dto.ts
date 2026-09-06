import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

/**
 * 自助修改登录密码 DTO
 *
 * 安全约束：必须携带旧密码并通过 Argon2 校验后才能设置新密码，
 * 防止会话被劫持后攻击者直接接管账号。
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '原密码不能为空' })
  oldPassword!: string;

  @IsString()
  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(6, { message: '新密码长度至少 6 位' })
  @MaxLength(72, { message: '新密码长度不能超过 72 位' })
  newPassword!: string;
}
