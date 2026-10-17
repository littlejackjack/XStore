import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { CreateServerDto, UpdateServerDto, UpdateServerStatusDto } from './dto/server.dto';
import { ServersService } from './servers.service';

@ApiTags('servers')
@Controller()
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  /** Buyer-facing list: only ONLINE servers with spare capacity. */
  @Public()
  @Get('servers/available')
  @ApiOperation({ summary: 'Servers available for checkout (name, location, status, users, capacity)' })
  available() {
    return this.serversService.listAvailable();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/servers')
  @ApiOperation({ summary: 'Full server inventory (admin)' })
  list() {
    return this.serversService.listAll();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('admin/servers')
  @ApiOperation({ summary: 'Register a new Marzban server (password is encrypted at rest)' })
  create(@Body() dto: CreateServerDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.serversService.create(dto, { id: actor.id, email: actor.email }, request.ip);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Put('admin/servers/:id')
  @ApiOperation({ summary: 'Update a Marzban server' })
  update(@Param('id') id: string, @Body() dto: UpdateServerDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.serversService.update(id, dto, { id: actor.id, email: actor.email }, request.ip);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Patch('admin/servers/:id/status')
  @ApiOperation({ summary: 'Manually set ONLINE / OFFLINE / MAINTENANCE' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateServerStatusDto,
    @CurrentUser() actor: User,
    @Req() request: Request,
  ) {
    return this.serversService.setStatus(id, dto, { id: actor.id, email: actor.email }, request.ip);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('admin/servers/:id/check')
  @ApiOperation({ summary: 'Probe the panel live and refresh status + active user count' })
  check(@Param('id') id: string) {
    return this.serversService.checkStatus(id);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Delete('admin/servers/:id')
  @ApiOperation({ summary: 'Remove a Marzban server' })
  remove(@Param('id') id: string, @CurrentUser() actor: User, @Req() request: Request) {
    return this.serversService.remove(id, { id: actor.id, email: actor.email }, request.ip);
  }
}
