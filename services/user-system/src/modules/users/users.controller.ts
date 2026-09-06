import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseEnumPipe,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { QueryUserDto } from './dto/query-user.dto.js';
import { AssignRolesDto } from './dto/assign-roles.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../../common/index.js';
import { CommonStatus } from '@prisma/client';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('sys:user:create')
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions('sys:user:list')
  async findAll(@Query() query: QueryUserDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('sys:user:query')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Put(':id')
  @RequirePermissions('sys:user:update')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Put(':id/roles')
  @RequirePermissions('sys:user:assign')
  async assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) {
    return this.usersService.assignRoles(id, dto);
  }

  @Patch(':id/reset-password')
  @RequirePermissions('sys:user:reset-pwd')
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto.newPassword);
  }

  @Patch(':id/status')
  @RequirePermissions('sys:user:update')
  async updateStatus(
    @Param('id') id: string,
    @Body('status', new ParseEnumPipe(CommonStatus)) status: CommonStatus,
  ) {
    return this.usersService.updateStatus(id, status);
  }

  @Delete(':id')
  @RequirePermissions('sys:user:delete')
  async remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
