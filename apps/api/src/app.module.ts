import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { ServersModule } from './modules/servers/servers.module';
import { MarzbanModule } from './modules/marzban/marzban.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ApiKeysModule } from './modules/apikeys/apikeys.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MailModule } from './modules/mail/mail.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { HealthController } from './modules/health/health.controller';
import { AuditController } from './modules/audit/audit.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RedisService } from './redis/redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      cache: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
            limit: Number(process.env.THROTTLE_LIMIT ?? 120),
          },
        ],
      }),
    }),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          // Fail fast instead of buffering commands forever when Redis is not
          // reachable (dev/preview environments): `queue.add()` rejects within
          // a second, and the caller decides how to degrade. Reconnects are
          // still attempted in the background, so a Redis restart recovers.
          enableOfflineQueue: false,
          maxRetriesPerRequest: null, // required by BullMQ
          connectTimeout: 3_000,
          retryStrategy: (times: number) => Math.min(times * 250, 2_000),
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    ServersModule,
    MarzbanModule,
    OrdersModule,
    PaymentsModule,
    WebhooksModule,
    ApiKeysModule,
    SettingsModule,
    MailModule,
    ProvisioningModule,
  ],
  controllers: [HealthController, AuditController],
  providers: [
    // Global guards: authentication first, then role-based access control.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Global validation: strip unknown fields, transform & whitelist payloads.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        stopAtFirstError: true,
      }),
    },
    // Global error normaliser: never leak internals to clients.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {
  constructor(private readonly redis: RedisService) {
    void this.redis; // ensures Redis boots before queues/processors
  }
}
