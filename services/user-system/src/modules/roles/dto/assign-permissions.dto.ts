import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class AssignPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ message: '权限 ID 列表不能为空' })
  permissionIds!: string[];
}
