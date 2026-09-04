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
} from '@nestjs/common';
import { DepartmentsService } from './departments.service.js';
import { CreateDepartmentDto } from './dto/create-department.dto.js';
import { UpdateDepartmentDto } from './dto/update-department.dto.js';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../../common/index.js';

@Controller('api/v1/departments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @RequirePermissions('sys:dept:create')
  async create(@Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(dto);
  }

  @Get('tree')
  @RequirePermissions('sys:dept:list')
  async findTree(@Query('keyword') keyword?: string) {
    return this.departmentsService.findTree(keyword);
  }

  @Get(':id')
  @RequirePermissions('sys:dept:query')
  async findOne(@Param('id') id: string) {
    return this.departmentsService.findById(id);
  }

  @Put(':id')
  @RequirePermissions('sys:dept:update')
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sys:dept:delete')
  async remove(@Param('id') id: string) {
    return this.departmentsService.remove(id);
  }
}
