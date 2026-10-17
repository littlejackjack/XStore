import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { MarzbanModule } from '../marzban/marzban.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([MarzbanServer]), ConfigModule, MarzbanModule, AuditModule],
  controllers: [ServersController],
  providers: [ServersService],
  exports: [ServersService],
})
export class ServersModule {}
