import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentsService } from './payments.service';
import { ApiKeysModule } from '../apikeys/apikeys.module';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Payment]), ConfigModule, ApiKeysModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
