import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { User } from '../../database/entities/user.entity';
import { UsersService } from './users.service';

class UpdateUserDto {
  @IsOptional()
  @IsEnum(['USER', 'ADMIN', 'SUPER_ADMIN'])
  role?: User['role'];

  @IsOptional()
  @IsEnum(['ACTIVE', 'SUSPENDED'])
  status?: User['status'];
}

@ApiTags('admin/users')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  list(@Query() query: PaginationDto) {
    return this.usersService.list(query.page, query.limit);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user role or status' })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateRoleOrStatus(actor, id, dto);
  }
}
