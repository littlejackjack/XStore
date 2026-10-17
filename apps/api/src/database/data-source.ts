/**
 * Dedicated DataSource for the TypeORM CLI (migration:generate / migration:run).
 * It is intentionally NOT part of the Nest DI graph.
 */
import { DataSource } from 'typeorm';
import { configuration } from '../config/configuration';
import * as entities from './entities';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? '',
  entities: Object.values(entities),
  migrations: ['dist/database/migrations/*.js'],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: ['error', 'warn'],
});

// Ensure env-based config validation also applies to CLI usage.
configuration();
