import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from '../../database/entities/api-key.entity';
import { ApiKeyProvider } from '../../database/entities/api-key.entity';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret, maskSecret } from '../../common/utils/crypto.util';

export interface ResolvedApiKey {
  provider: ApiKeyProvider;
  apiKey: string;
  webhookSecret: string | null;
  source: 'database' | 'environment';
}

const CACHE_PREFIX = 'apikeys:resolved:';
const CACHE_TTL_SECONDS = 60; // short TTL: rotations take effect within a minute
const REDIS_KEY_INDEX = 'apikeys:providers';

/**
 * Owns every third-party credential.
 *
 * Storage:  AES-256-GCM envelopes in Postgres (never plain text, never .env).
 * Access:   decrypted values are cached in Redis for 60s and NEVER leave the
 *           backend - the Admin Panel only ever sees masked values.
 * Control:  rotation requires SUPER_ADMIN and writes an audit-log entry.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Lists stored keys for the admin panel - values are always masked. */
  async list(): Promise<
    Array<{
      provider: ApiKeyProvider;
      configured: boolean;
      maskedKey: string | null;
      maskedWebhookSecret: string | null;
      lastUpdatedByEmail: string | null;
      updatedAt: Date | null;
    }>
  > {
    const rows = await this.apiKeyRepository.find();
    const providers: ApiKeyProvider[] = ['RESEND', 'BAYARGG'];
    return providers.map((provider) => {
      const row = rows.find((item) => item.provider === provider);
      return {
        provider,
        configured: Boolean(row),
        maskedKey: row ? maskSecret(this.decryptOrEmpty(row.keyEncrypted)) : null,
        maskedWebhookSecret: row?.webhookSecretEncrypted
          ? maskSecret(this.decryptOrEmpty(row.webhookSecretEncrypted))
          : null,
        lastUpdatedByEmail: row?.lastUpdatedByEmail ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  /**
   * Rotates (creates or updates) the credentials for a provider.
   * SUPER_ADMIN only - enforced by the controller's @Roles decorator.
   */
  async rotate(
    provider: ApiKeyProvider,
    values: { apiKey?: string; webhookSecret?: string },
    actor: { id: string; email: string },
    ip?: string,
  ): Promise<{ provider: ApiKeyProvider; updated: true }> {
    if (!values.apiKey && !values.webhookSecret) {
      throw new BadRequestException('Provide apiKey and/or webhookSecret to update');
    }
    if (values.apiKey !== undefined && values.apiKey.trim().length < 8) {
      throw new BadRequestException('API key looks too short - aborting');
    }

    const masterKey = this.config.get<string>('app.security.encryptionKey')!;
    let row = await this.apiKeyRepository.findOneBy({ provider });

    if (!row) {
      row = this.apiKeyRepository.create({ provider });
    }

    if (values.apiKey) {
      row.keyEncrypted = encryptSecret(values.apiKey.trim(), masterKey);
    }
    if (values.webhookSecret !== undefined) {
      row.webhookSecretEncrypted = values.webhookSecret
        ? encryptSecret(values.webhookSecret.trim(), masterKey)
        : null;
    }
    row.lastUpdatedBy = actor.id;
    row.lastUpdatedByEmail = actor.email;

    await this.apiKeyRepository.save(row);
    await this.invalidateCache(provider);

    await this.audit.record({
      action: 'API_KEY_ROTATED',
      entity: 'ApiKey',
      entityId: provider,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: {
        provider,
        apiKeyChanged: Boolean(values.apiKey),
        webhookSecretChanged: values.webhookSecret !== undefined,
      },
      ip,
    });

    this.logger.log(`API key rotated for ${provider} by ${actor.email}`);
    return { provider, updated: true };
  }

  /**
   * Returns the decrypted credential for internal use only.
   * Resolution order: database (authoritative) -> environment fallback.
   * Never expose this method's result through an HTTP response.
   */
  async resolve(provider: ApiKeyProvider): Promise<ResolvedApiKey> {
    const cacheKey = `${CACHE_PREFIX}${provider}`;
    const cached = await this.redis.getOrSet<ResolvedApiKey | null>(cacheKey, CACHE_TTL_SECONDS, async () => {
      const row = await this.apiKeyRepository.findOneBy({ provider });
      if (row) {
        const masterKey = this.config.get<string>('app.security.encryptionKey')!;
        return {
          provider,
          apiKey: decryptSecret(row.keyEncrypted, masterKey),
          webhookSecret: row.webhookSecretEncrypted ? decryptSecret(row.webhookSecretEncrypted, masterKey) : null,
          source: 'database' as const,
        };
      }

      // Fallback to environment (first boot / before admin configures the panel).
      const fallback =
        provider === 'RESEND'
          ? {
              apiKey: this.config.get<string>('app.resend.fallbackApiKey') ?? '',
              webhookSecret: null,
            }
          : {
              apiKey: this.config.get<string>('app.bayargg.fallbackApiKey') ?? '',
              webhookSecret: this.config.get<string>('app.bayargg.fallbackWebhookSecret') || null,
            };

      if (!fallback.apiKey) return null;
      return { provider, ...fallback, source: 'environment' as const };
    });

    if (!cached) {
      throw new BadRequestException(
        `${provider} API key is not configured. Set it in Admin Panel -> API Keys.`,
      );
    }
    return cached;
  }

  /** True when a usable credential exists for the provider. */
  async isConfigured(provider: ApiKeyProvider): Promise<boolean> {
    try {
      await this.resolve(provider);
      return true;
    } catch {
      return false;
    }
  }

  private async invalidateCache(provider: ApiKeyProvider): Promise<void> {
    await this.redis.del(`${CACHE_PREFIX}${provider}`, `${REDIS_KEY_INDEX}:${provider}`);
  }

  private decryptOrEmpty(envelope: string): string {
    try {
      return decryptSecret(envelope, this.config.get<string>('app.security.encryptionKey')!);
    } catch (error) {
      this.logger.error(`Failed to decrypt stored ${envelope.length > 0 ? 'secret' : 'value'}: ${(error as Error).message}`);
      return '';
    }
  }

  async getOrThrow(provider: ApiKeyProvider): Promise<ResolvedApiKey> {
    const resolved = await this.resolve(provider);
    if (!resolved) throw new NotFoundException(`No API key configured for ${provider}`);
    return resolved;
  }
}
