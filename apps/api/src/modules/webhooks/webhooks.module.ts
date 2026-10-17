import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { ApiKeysModule } from '../apikeys/apikeys.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Payment]),
    ConfigModule,
    ApiKeysModule,
    MailModule,
    SettingsModule,
    BullModule.registerQueue({ name: 'provisioning' }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
