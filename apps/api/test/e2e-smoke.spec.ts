/**
 * End-to-end smoke test.
 *
 * Boots the COMPLETE Nest application (all modules, guards, pipes, filters)
 * against an in-memory PostgreSQL (pg-mem) and then exercises the real HTTP
 * surface with supertest: registration, login, RBAC, catalog, checkout server
 * listing and the Bayar.gg webhook signature gate.
 *
 * Redis is intentionally absent: the app must degrade gracefully (cache
 * becomes a no-op) instead of crashing.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/xstore_test';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = 'smoke-test-jwt-secret-at-least-32-characters-long';
process.env.ENCRYPTION_KEY = 'smoke-test-encryption-key-32-chars-minimum';
process.env.DB_SYNC = 'false';
process.env.SWAGGER_ENABLED = 'false';
process.env.SEED_SUPER_ADMIN = 'false';
// The suite performs many auth calls; rate limiting is verified separately in
// throttling.spec.ts, so raise the limits here instead of fighting them.
process.env.THROTTLE_TTL = '60';
process.env.THROTTLE_LIMIT = '10000';
process.env.AUTH_THROTTLE_LIMIT = '1000';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import { AppModule } from '../src/app.module';
import * as entities from '../src/database/entities';
import { DataSource } from 'typeorm';

const MASTER_KEY = 'smoke-test-encryption-key-32-chars-minimum';

describe('XStore API (e2e smoke)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let createdProductId = '';
  let createdServerId = '';
  let mailed: Array<{ to: string; subject: string; html: string; text?: string }> = [];

  beforeAll(async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({ name: 'current_database', implementation: () => 'xstore_test' } as any);
    db.public.registerFunction({ name: 'version', implementation: () => 'PostgreSQL 16.0' } as any);
    db.public.registerFunction({ name: 'gen_random_uuid', implementation: () => randomUUID() } as any);
    db.public.registerFunction({ name: 'uuid_generate_v4', implementation: () => randomUUID() } as any);

    dataSource = await db.adapters.createTypeormConnection({
      type: 'postgres',
      entities: Object.values(entities),
      synchronize: true,
    } as any);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    // Record every transactional email the app tries to send (the Resend key is
    // intentionally absent, so nothing leaves the sandbox - we only assert the
    // intent, subject and payload).
    mailed = [];
    const { MailService } = await import('../src/modules/mail/mail.service');
    jest.spyOn(app.get(MailService), 'send').mockImplementation(async (input: any) => {
      mailed.push(input);
      return { ok: true };
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    try {
      await dataSource?.destroy();
    } catch {
      /* connection may already be closed by the app */
    }
  });

  it('GET /api/health reports ok', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body.services.database).toBe(true);
  });

  it('rejects unauthenticated admin access (global JWT guard)', async () => {
    await request(app.getHttpServer()).get('/api/admin/servers').expect(401);
  });

  it('registers a customer and issues an access token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'buyer@example.com', password: 'Sup3rSecret!', name: 'Buyer' })
      .expect(201);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.role).toBe('USER');
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a weak password at validation layer', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'weak@example.com', password: '123', name: 'Weak' })
      .expect(400);
  });

  it('rejects unknown-field payloads (whitelist validation)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'x@example.com', password: 'Sup3rSecret!', name: 'X', isAdmin: true })
      .expect(400);
  });

  it('logs the customer in', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'Sup3rSecret!' })
      .expect(200);
    expect(response.body.accessToken).toBeDefined();
  });

  it('rejects login with a wrong password without leaking details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'wrong-password' })
      .expect(401);
    expect(response.body.message).toBe('Invalid email or password');
  });

  it('forbids customers from admin routes (RBAC)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'Sup3rSecret!' });
    const token = login.body.accessToken as string;

    await request(app.getHttpServer()).get('/api/admin/products').set('Authorization', `Bearer ${token}`).expect(403);
  });

  describe('admin flow', () => {
    let adminToken = '';

    beforeAll(async () => {
      // Promote a user to SUPER_ADMIN directly in the (in-memory) database.
      const repo = dataSource.getRepository(entities.User);
      const admin = repo.create({
        id: randomUUID(),
        email: 'admin@example.com',
        name: 'Super Admin',
        passwordHash: '$2a$12$notarealhashbutlongenoughforthecolumnxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      });
      await repo.save(admin);

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@example.com', password: 'anything' });
      // Password hash is fake - login would fail, so mint a token via the service instead.
      const { AuthService } = await import('../src/modules/auth/auth.service');
      const authService = app.get(AuthService);
      const tokens = await authService.login('admin@example.com', 'anything').catch(() => null);
      void tokens;
      // Use the JWT service directly for a valid admin session.
      const { JwtService } = await import('@nestjs/jwt');
      const jwt = app.get(JwtService);
      adminToken = await jwt.signAsync(
        { sub: admin.id, email: admin.email, role: admin.role },
        { secret: process.env.JWT_SECRET, expiresIn: '15m' },
      );
      void response;
    });

    it('creates a product', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Pro 1 Month',
          slug: 'pro-1-month',
          description: 'Test plan',
          priceIdr: 69000,
          durationDays: 30,
          dataLimitGb: 100,
          features: ['All servers'],
        })
        .expect(201);
      createdProductId = response.body.id;
    });

    it('registers a Marzban server and stores the password encrypted', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/admin/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Singapore',
          baseUrl: 'https://marzban.example.com',
          username: 'admin',
          password: 'panel-password-123',
          location: 'Singapore',
          priority: 1,
          maxCapacity: 100,
        })
        .expect(201);
      createdServerId = response.body.id;
      expect(response.body.passwordEncrypted).toBeUndefined(); // never echoed back

      const row = await dataSource.getRepository(entities.MarzbanServer).findOneBy({ id: createdServerId });
      expect(row?.passwordEncrypted).not.toContain('panel-password-123');
      expect(JSON.parse(row!.passwordEncrypted).alg).toBe('aes-256-gcm');
    });

    it('stores a rotated API key encrypted and returns only a masked value', async () => {
      const rotated = await request(app.getHttpServer())
        .put('/api/admin/api-keys/BAYARGG')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ apiKey: 'pk_live_smoketest123', webhookSecret: 'whsec_smoketest456' })
        .expect(200);

      const row = await dataSource.getRepository(entities.ApiKey).findOneBy({ provider: 'BAYARGG' });
      expect(row?.keyEncrypted).not.toContain('pk_live_smoketest123');
      expect(row?.webhookSecretEncrypted).not.toContain('whsec_smoketest456');
      void rotated;

      const list = await request(app.getHttpServer())
        .get('/api/admin/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const bayargg = list.body.find((item: any) => item.provider === 'BAYARGG');
      expect(bayargg.maskedKey).not.toContain('pk_live_smoketest123');
      expect(bayargg.maskedKey.endsWith('t123')).toBe(true);
    });

    it('writes an audit log entry for the API key rotation', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const rotation = response.body.items.find((item: any) => item.action === 'API_KEY_ROTATED');
      expect(rotation).toBeDefined();
      expect(rotation.actorEmail).toBe('admin@example.com');
      expect(JSON.stringify(rotation.metadata)).toContain('[REDACTED]');
    });

    it('lists the server as available for checkout (public)', async () => {
      // Force the stored status to ONLINE so the public list includes it.
      await dataSource.getRepository(entities.MarzbanServer).update({ id: createdServerId }, { status: 'ONLINE' });

      const response = await request(app.getHttpServer()).get('/api/servers/available').expect(200);
      const server = response.body.find((item: any) => item.id === createdServerId);
      expect(server).toBeDefined();
      expect(server.name).toBe('Singapore');
      expect(server.status).toBe('ONLINE');
      expect(server.remainingCapacity).toBe(100);
      expect(server.passwordEncrypted).toBeUndefined();
      expect(server.username).toBeUndefined();
    });

    it('rejects a webhook with an invalid HMAC signature', async () => {
      const now = Math.floor(Date.now() / 1000).toString();
      await request(app.getHttpServer())
        .post('/api/webhooks/bayargg')
        .set('x-webhook-signature', 'forged')
        .set('x-webhook-timestamp', now)
        .send({ invoice_id: 'BAYAR-X', status: 'paid', final_amount: 69000 })
        .expect(401);
    });

    it('logs a customer in with an emailed one-time code (OTP)', async () => {
      const { MailService } = await import('../src/modules/mail/mail.service');
      const { RedisService } = await import('../src/redis/redis.service');
      const otpSpy = jest.spyOn(app.get(MailService), 'sendOtpCode');
      // The service allows one code per minute per address - clear the marker so
      // the tests below are independent (no-op when Redis is absent).
      await app.get(RedisService).del('otp:cooldown:LOGIN:buyer@example.com');

      await request(app.getHttpServer())
        .post('/api/auth/otp/request')
        .send({ email: 'buyer@example.com', purpose: 'LOGIN' })
        .expect(200);

      const code = otpSpy.mock.calls[0][1] as string;
      expect(code).toMatch(/^\d{6}$/);

      // A wrong code is rejected...
      await request(app.getHttpServer())
        .post('/api/auth/otp/verify')
        .send({ email: 'buyer@example.com', code: '000000' })
        .expect(401);

      // ...the right one signs the customer in...
      const verified = await request(app.getHttpServer())
        .post('/api/auth/otp/verify')
        .send({ email: 'buyer@example.com', code })
        .expect(200);
      expect(verified.body.accessToken).toBeDefined();
      expect(verified.body.user.email).toBe('buyer@example.com');

      // ...and the code is single use.
      await request(app.getHttpServer())
        .post('/api/auth/otp/verify')
        .send({ email: 'buyer@example.com', code })
        .expect(401);

      // The code itself is never persisted in clear text.
      const stored = await dataSource.getRepository(entities.EmailOtp).find();
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.some((row) => row.codeHash.includes(code))).toBe(false);
    });

    it('does not reveal whether an address exists (OTP request)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/otp/request')
        .send({ email: 'nobody@example.com', purpose: 'LOGIN' })
        .expect(200);
      expect(mailed.some((mail) => mail.to === 'nobody@example.com')).toBe(false);
    });

    it('verifies an email address with a one-time code', async () => {
      const { MailService } = await import('../src/modules/mail/mail.service');
      const { RedisService } = await import('../src/redis/redis.service');
      const otpSpy = jest.spyOn(app.get(MailService), 'sendOtpCode');
      await app.get(RedisService).del('otp:cooldown:EMAIL_VERIFICATION:buyer@example.com');

      await request(app.getHttpServer())
        .post('/api/auth/otp/request')
        .send({ email: 'buyer@example.com', purpose: 'EMAIL_VERIFICATION' })
        .expect(200);

      const code = otpSpy.mock.calls.at(-1)![1] as string;
      await request(app.getHttpServer())
        .post('/api/auth/otp/verify')
        .send({ email: 'buyer@example.com', code, purpose: 'EMAIL_VERIFICATION' })
        .expect(200);

      const user = await dataSource.getRepository(entities.User).findOneBy({ email: 'buyer@example.com' });
      expect(user?.emailVerified).toBe(true);
    });

    it('rejects a malformed order id with 400 instead of 500', async () => {
      await request(app.getHttpServer())
        .get('/api/orders/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('returns sales statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(response.body.totalRevenueIdr).toBeDefined();
      expect(response.body.ordersByStatus).toBeDefined();
    });
  });
});
