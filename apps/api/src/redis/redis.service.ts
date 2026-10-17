import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Thin wrapper around ioredis providing:
 * - one shared connection for caching
 * - `getOrSet` cache-aside helper used for decrypted secrets & settings
 * - a safe no-op fallback when Redis is unavailable, so the API still boots
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private connected = false;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('app.redis.url')!;
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.client.on('connect', () => {
      this.connected = true;
      this.logger.log('Redis connected');
    });
    this.client.on('error', (error: Error) => {
      this.connected = false;
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Raw client for BullMQ / direct usage. */
  get raw(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.connected) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this.connected) return;
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.warn(`Redis SET failed for ${key}: ${(error as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.client || !this.connected || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      /* cache invalidation is best-effort */
    }
  }

  /** Cache-aside helper: returns cached value or loads & stores it. */
  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        /* fall through to loader */
      }
    }
    const value = await loader();
    await this.set(key, JSON.stringify(value), ttlSeconds);
    return value;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
