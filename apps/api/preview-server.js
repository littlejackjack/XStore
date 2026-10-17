/**
 * PREVIEW-ONLY API server.
 *
 * Boots the COMPLETE production Nest application (all modules, guards, pipes)
 * against an in-memory PostgreSQL (pg-mem) seeded with demo data, so the
 * storefront + admin panel can be demoed without external infrastructure.
 *
 * This file is NOT part of the Docker images - production runs
 * `dist/main.js` against the real PostgreSQL/Redis from docker-compose.
 *
 * Usage:  node preview-server.js        (listens on 0.0.0.0:4000)
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://preview:preview@127.0.0.1:5432/xstore';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'preview-jwt-secret-at-least-32-characters-long';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || 'preview-encryption-key-32-chars-minimum-ok';
process.env.DB_SYNC = 'false';
process.env.SWAGGER_ENABLED = 'false';
process.env.SEED_SUPER_ADMIN = 'false';
process.env.TRUST_PROXY = 'false';
process.env.THROTTLE_TTL = '60';
process.env.THROTTLE_LIMIT = '1000';
process.env.AUTH_THROTTLE_LIMIT = '50';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:3000';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:3000';

const { randomUUID } = require('node:crypto');
const { newDb } = require('pg-mem');
const bcrypt = require('bcryptjs');
const { getDataSourceToken } = require('@nestjs/typeorm');

const { AppModule } = require('./dist/app.module');
const entities = require('./dist/database/entities');
const { encryptSecret } = require('./dist/common/utils/crypto.util');

const MASTER_KEY = process.env.ENCRYPTION_KEY;
const PORT = Number(process.env.APP_PORT || 4000);

async function main() {
  // ---------------------------------------------------------------- in-memory DB
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: 'current_database', implementation: () => 'xstore_preview' });
  db.public.registerFunction({ name: 'version', implementation: () => 'PostgreSQL 16.0' });
  db.public.registerFunction({ name: 'gen_random_uuid', implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'uuid_generate_v4', implementation: () => randomUUID() });

  const dataSource = await db.adapters.createTypeormConnection({
    type: 'postgres',
    entities: Object.values(entities),
    synchronize: true,
  });

  // ---------------------------------------------------------------- demo data
  await seed(dataSource);

  // ---------------------------------------------------------------- boot the app
  // Same technique as the e2e tests: compile AppModule but swap the real
  // DataSource for the in-memory one.
  const { Test } = require('@nestjs/testing');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDataSourceToken())
    .useValue(dataSource)
    .compile();

  const app = moduleRef.createNestApplication({ logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  const helmet = require('helmet');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );

  await app.listen(PORT, '0.0.0.0');
  console.log(`[preview] API listening on http://0.0.0.0:${PORT}/api (in-memory database)`);
}

async function seed(dataSource) {
  const userRepo = dataSource.getRepository(entities.User);
  const productRepo = dataSource.getRepository(entities.Product);
  const serverRepo = dataSource.getRepository(entities.MarzbanServer);
  const apiKeyRepo = dataSource.getRepository(entities.ApiKey);
  const settingRepo = dataSource.getRepository(entities.Setting);
  const orderRepo = dataSource.getRepository(entities.Order);
  const subscriptionRepo = dataSource.getRepository(entities.Subscription);
  const auditRepo = dataSource.getRepository(entities.AuditLog);

  const passwordHash = await bcrypt.hash('Demo1234!', 12);

  const admin = userRepo.create({
    id: randomUUID(),
    email: 'admin@xstore.id',
    name: 'Super Admin',
    passwordHash,
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
  });
  const customer = userRepo.create({
    id: randomUUID(),
    email: 'buyer@xstore.id',
    name: 'Budi Santoso',
    passwordHash,
    role: 'USER',
    status: 'ACTIVE',
  });
  await userRepo.save([admin, customer]);

  const products = await productRepo.save([
    productRepo.create({
      id: randomUUID(),
      slug: 'starter-1-bulan',
      name: 'Starter - 1 Bulan',
      description: 'Cocok untuk mencoba layanan. Akses semua server.',
      priceIdr: 25000,
      durationDays: 30,
      dataLimitGb: 50,
      features: ['Semua lokasi server', 'Kecepatan hingga 1 Gbps', 'Dukungan 1 perangkat'],
      isActive: true,
      sortOrder: 1,
    }),
    productRepo.create({
      id: randomUUID(),
      slug: 'pro-3-bulan',
      name: 'Pro - 3 Bulan',
      description: 'Paket terpopuler dengan kuota lebih besar.',
      priceIdr: 69000,
      durationDays: 90,
      dataLimitGb: 200,
      features: ['Semua lokasi server', 'Kecepatan hingga 1 Gbps', 'Dukungan 3 perangkat', 'Prioritas dukungan'],
      isActive: true,
      sortOrder: 2,
    }),
    productRepo.create({
      id: randomUUID(),
      slug: 'unlimited-1-tahun',
      name: 'Unlimited - 1 Tahun',
      description: 'Tanpa batas kuota untuk pengguna berat.',
      priceIdr: 199000,
      durationDays: 365,
      dataLimitGb: null,
      features: ['Semua lokasi server', 'Kuota unlimited', 'Dukungan 5 perangkat', 'Prioritas dukungan'],
      isActive: true,
      sortOrder: 3,
    }),
  ]);

  const servers = await serverRepo.save([
    serverRepo.create({
      id: randomUUID(),
      name: 'Singapore 01',
      baseUrl: 'https://marzban-sgp.xstore.id',
      username: 'admin',
      passwordEncrypted: encryptSecret('demo-panel-password', MASTER_KEY),
      status: 'ONLINE',
      activeUsers: 137,
      maxCapacity: 500,
      location: 'Singapore',
      priority: 1,
      notes: 'Node bare-metal 1 Gbps - paling rendah latency untuk Indonesia barat',
      isActive: true,
      lastCheckedAt: new Date(),
    }),
    serverRepo.create({
      id: randomUUID(),
      name: 'Tokyo 01',
      baseUrl: 'https://marzban-nrt.xstore.id',
      username: 'admin',
      passwordEncrypted: encryptSecret('demo-panel-password', MASTER_KEY),
      status: 'ONLINE',
      activeUsers: 42,
      maxCapacity: 300,
      location: 'Japan',
      priority: 2,
      notes: 'Cocok untuk streaming & gaming',
      isActive: true,
      lastCheckedAt: new Date(),
    }),
    serverRepo.create({
      id: randomUUID(),
      name: 'Frankfurt 01',
      baseUrl: 'https://marzban-fra.xstore.id',
      username: 'admin',
      passwordEncrypted: encryptSecret('demo-panel-password', MASTER_KEY),
      status: 'MAINTENANCE',
      activeUsers: 0,
      maxCapacity: 250,
      location: 'Germany',
      priority: 3,
      notes: 'Maintenance terjadwal - migrasi kernel',
      isActive: true,
      lastCheckedAt: new Date(),
    }),
  ]);

  // Real credentials can be injected through the environment for a live demo
  // (PREVIEW_RESEND_API_KEY / PREVIEW_BAYARGG_API_KEY / PREVIEW_BAYARGG_WEBHOOK_SECRET).
  // They are encrypted exactly like production and are NEVER written to git or .env.
  const bayarggKey = process.env.PREVIEW_BAYARGG_API_KEY || 'pk_live_demo_api_key_1234567890';
  const bayarggWebhook = process.env.PREVIEW_BAYARGG_WEBHOOK_SECRET || 'whsec_demo_webhook_secret_1234567890';
  const resendKey = process.env.PREVIEW_RESEND_API_KEY || 're_demo_resend_api_key_1234567890';

  await apiKeyRepo.save([
    apiKeyRepo.create({
      id: randomUUID(),
      provider: 'BAYARGG',
      keyEncrypted: encryptSecret(bayarggKey, MASTER_KEY),
      webhookSecretEncrypted: encryptSecret(bayarggWebhook, MASTER_KEY),
      lastUpdatedBy: admin.id,
      lastUpdatedByEmail: admin.email,
    }),
    apiKeyRepo.create({
      id: randomUUID(),
      provider: 'RESEND',
      keyEncrypted: encryptSecret(resendKey, MASTER_KEY),
      lastUpdatedBy: admin.id,
      lastUpdatedByEmail: admin.email,
    }),
  ]);

  await settingRepo.save([
    settingRepo.create({ key: 'site.name', value: 'XStore' }),
    settingRepo.create({ key: 'site.tagline', value: 'Premium VPN subscriptions, delivered instantly.' }),
    settingRepo.create({ key: 'site.currency', value: 'IDR' }),
    settingRepo.create({ key: 'site.registrationEnabled', value: true }),
    settingRepo.create({ key: 'site.supportContact', value: 'support@xstore.id' }),
    settingRepo.create({ key: 'order.autoProvision', value: true }),
    settingRepo.create({ key: 'notifications.expiryReminderDays', value: 3 }),
  ]);

  // One completed order + active subscription for the demo customer.
  const order = await orderRepo.save(
    orderRepo.create({
      id: randomUUID(),
      orderNumber: 'XST-DEMO-0001',
      userId: customer.id,
      productId: products[1].id,
      serverId: servers[0].id,
      amountIdr: 69000,
      status: 'COMPLETED',
      bayarInvoiceId: 'BAYAR-DEMO-0001',
      paymentUrl: 'https://www.bayar.gg/pay?invoice=BAYAR-DEMO-0001',
      paidAt: new Date(Date.now() - 3 * 86400_000),
    }),
  );
  await subscriptionRepo.save(
    subscriptionRepo.create({
      id: randomUUID(),
      userId: customer.id,
      orderId: order.id,
      productId: products[1].id,
      serverId: servers[0].id,
      marzbanUsername: 'xstore_demo_0001',
      subscriptionUrl: 'https://marzban-sgp.xstore.id/sub/xstoredemo0001secret',
      status: 'ACTIVE',
      dataLimitBytes: 200 * 1024 ** 3,
      usedTrafficBytes: Math.floor(63.4 * 1024 ** 3),
      expireAt: new Date(Date.now() + 87 * 86400_000),
    }),
  );

  // Second subscription: expires in 2 days so the daily reminder job has work to do.
  await subscriptionRepo.save(
    subscriptionRepo.create({
      id: randomUUID(),
      userId: customer.id,
      orderId: order.id,
      productId: products[0].id,
      serverId: servers[1].id,
      marzbanUsername: 'xstore_demo_0002',
      subscriptionUrl: 'https://marzban-tyo.xstore.id/sub/xstoredemo0002secret',
      status: 'ACTIVE',
      dataLimitBytes: 50 * 1024 ** 3,
      usedTrafficBytes: Math.floor(12.1 * 1024 ** 3),
      expireAt: new Date(Date.now() + 2 * 86400_000),
      expiryReminderSentAt: null,
    }),
  );

  await auditRepo.save([
    auditRepo.create({
      id: randomUUID(),
      action: 'API_KEY_ROTATED',
      entity: 'ApiKey',
      entityId: 'BAYARGG',
      actorId: admin.id,
      actorEmail: admin.email,
      metadata: { provider: 'BAYARGG', apiKeyChanged: true, webhookSecretChanged: true },
      ip: '103.28.14.9',
    }),
    auditRepo.create({
      id: randomUUID(),
      action: 'SERVER_CREATED',
      entity: 'MarzbanServer',
      entityId: servers[0].id,
      actorId: admin.id,
      actorEmail: admin.email,
      metadata: { name: 'Singapore 01', baseUrl: 'https://marzban-sgp.xstore.id', location: 'Singapore' },
      ip: '103.28.14.9',
    }),
    auditRepo.create({
      id: randomUUID(),
      action: 'SUBSCRIPTION_PROVISIONED',
      entity: 'Subscription',
      entityId: order.id,
      actorId: customer.id,
      actorEmail: customer.email,
      metadata: { orderNumber: 'XST-DEMO-0001', serverId: servers[0].id, marzbanUsername: 'xstore_demo_0001' },
      ip: '36.72.11.5',
    }),
  ]);

  console.log('[preview] seeded: 2 users, 3 products, 3 servers, 2 API keys, 1 order, 2 subscriptions, 3 audit entries');
}

main().catch((error) => {
  console.error('[preview] failed to start:', error);
  process.exit(1);
});
