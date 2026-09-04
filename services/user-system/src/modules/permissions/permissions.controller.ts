import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { UpdatePermissionDto } from './dto/update-permission.dto.js';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../../common/index.js';

@Controller('api/v1/permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * 获取当前登录用户可访问的权限码与菜单树
   */
  @Get('me')
  async getMyPermissions(@Req() req: any) {
    return this.permissionsService.getCurrentUserPermissions(req.user.userId);
  }

  /**
   * 获取全系统完整的树形权限资源 (用于角色授权勾选)
   */
  @Get('tree')
  @RequirePermissions('sys:permission:list')
  async getTree() {
    return this.permissionsService.findTree();
  }

  /**
   * 列表查询
   */
  @Get()
  @RequirePermissions('sys:permission:list')
  async findAll(@Query('keyword') keyword?: string) {
    return this.permissionsService.findAll(keyword);
  }

  /**
   * 单项详情
   */
  @Get(':id')
  @RequirePermissions('sys:permission:query')
  async findOne(@Param('id') id: string) {
    return this.permissionsService.findById(id);
  }

  /**
   * 创建权限
   */
  @Post()
  @RequirePermissions('sys:permission:create')
  async create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto);
  }

  /**
   * 更新权限
   */
  @Put(':id')
  @RequirePermissions('sys:permission:update')
  async update(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto);
  }

  /**
   * 删除权限
   */
  @Delete(':id')
  @RequirePermissions('sys:permission:delete')
  async remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
