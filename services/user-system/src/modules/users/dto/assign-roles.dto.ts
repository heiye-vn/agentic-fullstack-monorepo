import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ message: '角色 ID 列表不能为空' })
  roleIds!: string[];
}
