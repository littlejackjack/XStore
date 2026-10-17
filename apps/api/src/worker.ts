/**
 * Worker entrypoint.
 *
 * Runs the BullMQ processors (provisioning + server status) WITHOUT the HTTP
 * server. Deployed as the separate `worker` service in docker-compose.yml:
 *
 *   docker compose up -d worker
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ServerStatusProcessor } from './modules/provisioning/server-status.processor';
import { SubscriptionExpiryProcessor } from './modules/provisioning/subscription-expiry.processor';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: true,
  });

  app.enableShutdownHooks();

  // Register the repeatable server-status job (idempotent - fixed jobId).
  const statusQueue = app.get<Queue>(getQueueToken('server-status'), { strict: false });
  const processor = app.get(ServerStatusProcessor, { strict: false });
  await ServerStatusProcessor.schedule(statusQueue, processor.intervalMinutes);

  // Daily subscription-expiry reminder emails (Resend).
  const notificationsQueue = app.get<Queue>(getQueueToken('notifications'), { strict: false });
  await SubscriptionExpiryProcessor.schedule(notificationsQueue);

  const logger = new Logger('Worker');
  logger.log('XStore worker started (provisioning, server status, notifications queues)');

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal} - shutting down worker`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
