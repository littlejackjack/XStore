import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../src/modules/apikeys/apikeys.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { RedisService } from '../src/redis/redis.service';

const MASTER_KEY = 'unit-test-encryption-key-32-chars-minimum';

/** Minimal in-memory stand-in for RedisService. */
class FakeRedis {
  private store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.store.set(key, value);
  }
  async del(...keys: string[]) {
    keys.forEach((key) => this.store.delete(key));
  }
  async getOrSet<T>(key: string, _ttl: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return JSON.parse(cached) as T;
    const value = await loader();
    await this.set(key, JSON.stringify(value));
    return value;
  }
}

function buildService() {
  const rows: any[] = [];
  const repository = {
    find: jest.fn(async () => rows),
    findOneBy: jest.fn(async ({ provider }: any) => rows.find((row) => row.provider === provider) ?? null),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      const existing = rows.find((row) => row.provider === value.provider);
      if (existing) Object.assign(existing, value);
      else rows.push(value);
      return value;
    }),
  };
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
  const config = { get: jest.fn(() => MASTER_KEY) } as unknown as ConfigService;
  const service = new ApiKeysService(
    repository as any,
    new FakeRedis() as unknown as RedisService,
    config,
    audit,
  );
  return { service, rows, repository, audit };
}

describe('ApiKeysService', () => {
  const actor = { id: 'admin-1', email: 'admin@example.com' };

  it('stores the API key encrypted, never in plain text', async () => {
    const { service, rows } = buildService();
    await service.rotate('BAYARGG', { apiKey: 'pk_live_abcd1234', webhookSecret: 'whsec_xyz' }, actor);

    const row = rows[0];
    expect(row.keyEncrypted).not.toContain('pk_live_abcd1234');
    expect(row.webhookSecretEncrypted).not.toContain('whsec_xyz');
    expect(JSON.parse(row.keyEncrypted)).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
  });

  it('resolves the decrypted key for internal use', async () => {
    const { service } = buildService();
    await service.rotate('RESEND', { apiKey: 're_live_secret_key' }, actor);
    const resolved = await service.resolve('RESEND');
    expect(resolved.apiKey).toBe('re_live_secret_key');
    expect(resolved.source).toBe('database');
  });

  it('masks keys in the admin listing', async () => {
    const { service } = buildService();
    await service.rotate('RESEND', { apiKey: 're_live_secret_key' }, actor);
    const list = await service.list();
    const resend = list.find((item) => item.provider === 'RESEND')!;
    expect(resend.configured).toBe(true);
    expect(resend.maskedKey).not.toContain('re_live_secret_key');
    expect(resend.maskedKey?.endsWith('_key')).toBe(true);
  });

  it('caches the decrypted key in Redis', async () => {
    const { service, repository } = buildService();
    await service.rotate('BAYARGG', { apiKey: 'pk_live_cache_test' }, actor);
    await service.resolve('BAYARGG');
    const lookupsBefore = repository.findOneBy.mock.calls.length;
    await service.resolve('BAYARGG');
    await service.resolve('BAYARGG');
    expect(repository.findOneBy.mock.calls.length).toBe(lookupsBefore);
  });

  it('invalidates the cache after rotation', async () => {
    const { service } = buildService();
    await service.rotate('BAYARGG', { apiKey: 'pk_live_first_key' }, actor);
    expect((await service.resolve('BAYARGG')).apiKey).toBe('pk_live_first_key');
    await service.rotate('BAYARGG', { apiKey: 'pk_live_second_key' }, actor);
    expect((await service.resolve('BAYARGG')).apiKey).toBe('pk_live_second_key');
  });

  it('writes an audit log entry on rotation', async () => {
    const { service, audit } = buildService();
    await service.rotate('BAYARGG', { apiKey: 'pk_live_audit_key' }, actor, '10.0.0.1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'API_KEY_ROTATED', entity: 'ApiKey', actorEmail: actor.email }),
    );
  });

  it('rejects empty rotations', async () => {
    const { service } = buildService();
    await expect(service.rotate('BAYARGG', {}, actor)).rejects.toThrow();
  });
});
