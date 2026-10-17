import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailOtp } from '../../database/entities/email-otp.entity';
import { User } from '../../database/entities/user.entity';
import { RedisModule } from '../../redis/redis.module';
import { MailModule } from '../mail/mail.module';
import { OtpService } from './otp.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([EmailOtp, User]), RedisModule, MailModule],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
