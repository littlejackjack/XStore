import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from './subscriptions.service';
import { ExpiryReminderService } from './expiry-reminder.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly expiryReminders: ExpiryReminderService,
  ) {}

  @Get('subscriptions/me')
  @ApiOperation({ summary: 'My subscriptions (config link, traffic, expiry)' })
  mine(@CurrentUser() user: User) {
    return this.subscriptionsService.listForUser(user.id);
  }

  @Post('subscriptions/:id/sync')
  @ApiOperation({ summary: 'Refresh traffic & expiry from the Marzban panel' })
  sync(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.syncUsage(user, id);
  }

  /**
   * Runs the expiry-reminder scan immediately (same code as the daily job) so
   * the Resend integration can be verified from the admin panel.
   */
  @Post('admin/subscriptions/run-expiry-reminders')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Send subscription expiry reminder emails now (admin)' })
  async runExpiryReminders() {
    return this.expiryReminders.sendDueReminders();
  }

  @Get('admin/subscriptions')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'All subscriptions (admin)' })
  all() {
    return this.subscriptionsService.listAll();
  }
}
