import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('subscriptions/me')
  @ApiOperation({ summary: 'My subscriptions (config link, traffic, expiry)' })
  mine(@CurrentUser() user: User) {
    return this.subscriptionsService.listForUser(user.id);
  }

  @Post('subscriptions/:id/sync')
  @ApiOperation({ summary: 'Refresh traffic & expiry from the Marzban panel' })
  sync(@CurrentUser() user: User, @Param('id') id: string) {
    return this.subscriptionsService.syncUsage(user, id);
  }

  @Get('admin/subscriptions')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'All subscriptions (admin)' })
  all() {
    return this.subscriptionsService.listAll();
  }
}
