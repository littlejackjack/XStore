import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { ApiKeysModule } from '../apikeys/apikeys.module';

@Module({
  imports: [ConfigModule, ApiKeysModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
