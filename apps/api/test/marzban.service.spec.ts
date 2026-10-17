import { ConfigService } from '@nestjs/config';
import { MarzbanService } from '../src/modules/marzban/marzban.service';
import { RedisService } from '../src/redis/redis.service';
import { encryptSecret } from '../src/common/utils/crypto.util';

const MASTER_KEY = 'unit-test-encryption-key-32-chars-minimum';

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
}

const SERVER = {
  id: 'server-1',
  name: 'Singapore',
  baseUrl: 'https://marzban.example.com/',
  username: 'admin',
  passwordEncrypted: encryptSecret('super-secret-password', MASTER_KEY),
} as any;

function buildService() {
  const config = {
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'app.security.encryptionKey': MASTER_KEY,
        'app.marzban.defaultInbounds': { vless: ['VLESS TCP REALITY'] },
        'app.marzban.requestTimeoutMs': 15000,
      };
      return map[key];
    }),
  } as unknown as ConfigService;
  return new MarzbanService(config, new FakeRedis() as unknown as RedisService);
}

describe('MarzbanService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetch(handler: (url: string, init: any) => { status: number; body: unknown }) {
    const spy = jest.fn(async (url: any, init: any) => {
      const result = handler(String(url), init);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        text: async () => JSON.stringify(result.body),
        json: async () => result.body,
      } as any;
    });
    global.fetch = spy as any;
    return spy;
  }

  it('logs in and caches the admin token in Redis', async () => {
    const service = buildService();
    const spy = mockFetch((url, init) => {
      expect(url).toBe('https://marzban.example.com/api/admin/token');
      expect(init.body.toString()).toContain('username=admin');
      expect(init.body.toString()).toContain('password=super-secret-password');
      return { status: 200, body: { access_token: 'jwt-token-123' } };
    });

    const token = await service.getAdminToken(SERVER);
    expect(token).toBe('jwt-token-123');
    expect(spy).toHaveBeenCalledTimes(1);

    await service.getAdminToken(SERVER);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('creates a user with the expected payload and bearer token', async () => {
    const service = buildService();
    let createBody: any;
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/token')) return { status: 200, body: { access_token: 'jwt-token-123' } };
      expect(url).toBe('https://marzban.example.com/api/user');
      expect(init.headers.Authorization).toBe('Bearer jwt-token-123');
      createBody = JSON.parse(init.body);
      return {
        status: 200,
        body: { username: createBody.username, subscription_url: 'https://sub.example.com/abc', status: 'active' },
      };
    });

    const created = await service.createUser(SERVER, {
      username: 'xstore_test',
      dataLimitBytes: 50 * 1024 ** 3,
      expireAt: Math.floor(Date.now() / 1000) + 86400,
      note: 'test order',
    });

    expect(createBody.status).toBe('active');
    expect(createBody.data_limit).toBe(50 * 1024 ** 3);
    expect(createBody.expire).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(createBody.proxies.vless.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createBody.inbounds).toEqual({ vless: ['VLESS TCP REALITY'] });
    expect(created.subscription_url).toBe('https://sub.example.com/abc');
  });

  it('retries with a fresh token after a 401', async () => {
    const service = buildService();
    let authCalls = 0;
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/token')) {
        authCalls += 1;
        return { status: 200, body: { access_token: `token-${authCalls}` } };
      }
      if (init.headers.Authorization === 'Bearer token-1') {
        return { status: 401, body: { detail: 'Not authenticated' } };
      }
      return { status: 200, body: { username: 'xstore_test', subscription_url: 'https://sub/x', status: 'active' } };
    });

    const created = await service.createUser(SERVER, {
      username: 'xstore_test',
      dataLimitBytes: null,
      expireAt: null,
    });
    expect(authCalls).toBe(2);
    expect(created.subscription_url).toBe('https://sub/x');
  });

  it('reports a server as offline when unreachable', async () => {
    const service = buildService();
    mockFetch(() => ({ status: 500, body: { detail: 'boom' } }));
    const result = await service.checkHealth(SERVER);
    expect(result.online).toBe(false);
  });

  it('never returns the panel password', async () => {
    const service = buildService();
    mockFetch(() => ({ status: 200, body: { access_token: 't' } }));
    const serialised = JSON.stringify(await service.getAdminToken(SERVER));
    expect(serialised).not.toContain('super-secret-password');
  });
});
