import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MarzbanService } from './marzban.service';
import { RedisModule } from '../../redis/redis.module';

/**
 * Global module: any feature (orders, servers, worker) can inject
 * MarzbanService to talk to a specific panel instance.
 */
@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [MarzbanService],
  exports: [MarzbanService],
})
export class MarzbanModule {}
