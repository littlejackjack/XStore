import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';

const CACHE_PREFIX = 'settings:';
const CACHE_TTL_SECONDS = 300;

const PUBLIC_KEYS = ['site.name', 'site.tagline', 'site.currency', 'site.registrationEnabled', 'site.supportContact'];

/** Keys an admin may edit from Admin Panel -> Settings. */
const ADMIN_KEYS = [
  ...PUBLIC_KEYS,
  'order.autoProvision',
  'notifications.expiryReminderDays',
  'notifications.paymentEmailEnabled',
  'notifications.invoiceEmailEnabled',
];

/**
 * Editable site settings with Redis caching.
 * Public values are served to unauthenticated visitors; the admin endpoint
 * exposes (and can update) every key.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /** Values safe to expose on the landing page. */
  async getPublic() {
    const rows = await this.settingRepository.find();
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      siteName: map.get('site.name') ?? 'XStore',
      tagline: map.get('site.tagline') ?? '',
      currency: map.get('site.currency') ?? 'IDR',
      registrationEnabled: map.get('site.registrationEnabled') ?? true,
      supportContact: map.get('site.supportContact') ?? '',
    };
  }

  async getAll() {
    const rows = await this.settingRepository.find({ order: { key: 'ASC' } });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    return this.redis.getOrSet<T>(`${CACHE_PREFIX}${key}`, CACHE_TTL_SECONDS, async () => {
      const row = await this.settingRepository.findOneBy({ key });
      return row ? (row.value as T) : fallback;
    });
  }

  async update(values: Record<string, unknown>, actor: { id: string; email: string }, ip?: string): Promise<Record<string, unknown>> {
    const allowed = ADMIN_KEYS;
    const entries = Object.entries(values).filter(([key]) => allowed.includes(key));
    if (entries.length === 0) throw new BadRequestException('No updatable settings supplied');

    for (const [key, value] of entries) {
      await this.settingRepository.save({ key, value } as Setting);
      await this.redis.del(`${CACHE_PREFIX}${key}`);
    }

    await this.audit.record({
      action: 'SETTINGS_UPDATED',
      entity: 'Setting',
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { keys: entries.map(([key]) => key) },
      ip,
    });

    return this.getAll();
  }
}
