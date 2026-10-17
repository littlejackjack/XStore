import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Single TypeORM connection for the whole application.
 * `synchronize` is only ever enabled through DB_SYNC=true (development);
 * production relies on SQL migrations (see database/migrations + run-migrations).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('app.db.url') ?? '';
        return {
          type: 'postgres' as const,
          url,
          autoLoadEntities: true,
          synchronize: config.get<boolean>('app.db.sync') ?? false,
          logging: config.get<boolean>('app.isProduction') ? (['error', 'warn'] as const) : (['error', 'warn'] as const),
          extra: {
            max: 20,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
          },
          // Managed Postgres (RDS/Supabase/Neon) usually requires TLS.
          ssl: /sslmode=require/i.test(url) ? ({ rejectUnauthorized: false } as const) : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
