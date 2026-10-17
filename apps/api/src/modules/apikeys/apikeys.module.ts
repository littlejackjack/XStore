import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../../database/entities/api-key.entity';
import { ApiKeysController } from './apikeys.controller';
import { ApiKeysService } from './apikeys.service';
import { AuditModule } from '../audit/audit.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), ConfigModule, AuditModule, RedisModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
