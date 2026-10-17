import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Order } from '../../database/entities/order.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { ProvisioningProcessor } from './provisioning.processor';
import { ServerStatusProcessor } from './server-status.processor';
import { SubscriptionExpiryProcessor } from './subscription-expiry.processor';
import { ExpiryReminderService } from './expiry-reminder.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { MarzbanModule } from '../marzban/marzban.module';
import { MailModule } from '../mail/mail.module';
import { AuditModule } from '../audit/audit.module';
import { ServersModule } from '../servers/servers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Subscription, MarzbanServer]),
    ConfigModule,
    BullModule.registerQueue(
      { name: 'provisioning' },
      { name: 'server-status' },
      { name: 'notifications' },
    ),
    MarzbanModule,
    MailModule,
    AuditModule,
    ServersModule,
    SettingsModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    ProvisioningProcessor,
    ServerStatusProcessor,
    SubscriptionExpiryProcessor,
    ExpiryReminderService,
    SubscriptionsService,
  ],
  exports: [SubscriptionsService, ExpiryReminderService],
})
export class ProvisioningModule {}
