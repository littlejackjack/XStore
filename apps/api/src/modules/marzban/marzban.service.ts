import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { RedisService } from '../../redis/redis.service';
import { decryptSecret } from '../../common/utils/crypto.util';

export interface MarzbanToken {
  accessToken: string;
}

export interface MarzbanUserPayload {
  username: string;
  /** Data limit in bytes; 0 or null = unlimited. */
  dataLimitBytes: number | null;
  /** Expiry as unix timestamp (seconds); null = no expiry. */
  expireAt: number | null;
  note?: string;
  proxies?: Record<string, unknown>;
  inbounds?: Record<string, string[]>;
}

export interface MarzbanCreatedUser {
  username: string;
  subscription_url: string | null;
  expire: number | null;
  data_limit: number | null;
  status: string;
}

export interface MarzbanSystemStats {
  version: string | null;
  total_user: number;
  users_active: number;
  mem_total: number | null;
  cpu_cores: number | null;
}

const TOKEN_CACHE_PREFIX = 'marzban:token:';
const TOKEN_TTL_SECONDS = 45 * 60; // Marzban admin tokens are valid ~60 minutes

/**
 * Modular Marzban integration - the ONLY place in the codebase that talks to a
 * Marzban panel. It is deliberately instance-agnostic: every call receives the
 * `MarzbanServer` entity so the same code drives N panels.
 *
 * - Admin tokens are cached in Redis per server (short TTL, auto re-login).
 * - The stored password is decrypted on demand from its AES-256-GCM envelope.
 * - All requests have a hard timeout and never log credentials.
 */
@Injectable()
export class MarzbanService {
  private readonly logger = new Logger(MarzbanService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /** Authenticates against the panel and caches the admin token in Redis. */
  async getAdminToken(server: MarzbanServer): Promise<string> {
    const cacheKey = `${TOKEN_CACHE_PREFIX}${server.id}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const password = decryptSecret(
      server.passwordEncrypted,
      this.config.get<string>('app.security.encryptionKey')!,
    );

    const body = new URLSearchParams({
      grant_type: 'password',
      username: server.username,
      password,
      scope: '',
      client_id: '',
      client_secret: '',
    });

    const response = await this.request<MarzbanToken & { access_token?: string }>(server, '/api/admin/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    // Marzban returns `access_token` (OAuth2 style).
    const accessToken = response.access_token ?? response.accessToken;
    if (!accessToken) {
      throw new ServiceUnavailableException('Marzban did not return an access token');
    }
    await this.redis.set(cacheKey, accessToken, TOKEN_TTL_SECONDS);
    return accessToken;
  }

  /** Drops the cached token (called when a request returns 401). */
  async invalidateToken(serverId: string): Promise<void> {
    await this.redis.del(`${TOKEN_CACHE_PREFIX}${serverId}`);
  }

  /** Creates a VPN user on the given panel. */
  async createUser(server: MarzbanServer, payload: MarzbanUserPayload): Promise<MarzbanCreatedUser> {
    const token = await this.getAdminToken(server);
    const body = {
      username: payload.username,
      proxies: payload.proxies ?? { vless: { id: randomUUID() } },
      inbounds: payload.inbounds ?? this.config.get('app.marzban.defaultInbounds') ?? {},
      data_limit: payload.dataLimitBytes && payload.dataLimitBytes > 0 ? payload.dataLimitBytes : 0,
      expire: payload.expireAt ?? null,
      status: 'active',
      note: payload.note ?? '',
    };

    try {
      return await this.request<MarzbanCreatedUser>(server, '/api/user', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A stale cached token is the most common cause - retry once after refresh.
      if (error instanceof ServiceUnavailableException && /401/.test(error.message)) {
        await this.invalidateToken(server.id);
        const freshToken = await this.getAdminToken(server);
        return this.request<MarzbanCreatedUser>(server, '/api/user', {
          method: 'POST',
          headers: { Authorization: `Bearer ${freshToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      throw error;
    }
  }

  /** Fetches a single user (used to sync traffic usage / expiry). */
  async getUser(server: MarzbanServer, username: string): Promise<Record<string, unknown>> {
    const token = await this.getAdminToken(server);
    return this.request<Record<string, unknown>>(server, `/api/user/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** Lists users (used to count active users for capacity display). */
  async listUsers(server: MarzbanServer): Promise<Array<Record<string, unknown>>> {
    const token = await this.getAdminToken(server);
    return this.request<Array<Record<string, unknown>>>(server, '/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** Resets the used traffic of a user (support action). */
  async resetUserTraffic(server: MarzbanServer, username: string): Promise<void> {
    const token = await this.getAdminToken(server);
    await this.request<unknown>(server, `/api/user/${encodeURIComponent(username)}/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** Deletes a user from the panel (refund / cancellation). */
  async deleteUser(server: MarzbanServer, username: string): Promise<void> {
    const token = await this.getAdminToken(server);
    await this.request<unknown>(server, `/api/user/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** System stats - the cheapest reliable liveness probe. */
  async getSystemStats(server: MarzbanServer): Promise<MarzbanSystemStats> {
    const token = await this.getAdminToken(server);
    const raw = await this.request<Record<string, any>>(server, '/api/system', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      version: raw.version ?? null,
      total_user: Number(raw.total_user ?? 0),
      users_active: Number(raw.users_active ?? 0),
      mem_total: raw.mem_total != null ? Number(raw.mem_total) : null,
      cpu_cores: raw.cpu_cores != null ? Number(raw.cpu_cores) : null,
    };
  }

  /** Lightweight connectivity check used by the admin "Check status" button. */
  async checkHealth(server: MarzbanServer): Promise<{ online: boolean; activeUsers: number; error?: string }> {
    try {
      const stats = await this.getSystemStats(server);
      return { online: true, activeUsers: stats.users_active };
    } catch (error) {
      return { online: false, activeUsers: 0, error: (error as Error).message.slice(0, 200) };
    }
  }

  /**
   * Performs an HTTP call against the panel with timeout + error normalisation.
   * Never throws raw fetch errors and never logs secrets.
   */
  private async request<T>(
    server: MarzbanServer,
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams },
  ): Promise<T> {
    const timeoutMs = this.config.get<number>('app.marzban.requestTimeoutMs')!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${server.baseUrl.replace(/\/+$/, '')}${path}`;
      const response = await fetch(url, {
        method: init.method ?? 'GET',
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ServiceUnavailableException(
          `Marzban responded ${response.status} for ${path}: ${detail.slice(0, 300)}`,
        );
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        `Marzban request failed (${path}): ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
