/**
 * Integration test: runs the real TypeORM entities (and the initial migration
 * SQL) against an in-memory PostgreSQL emulator to prove the schema, entity
 * metadata and repository operations are valid.
 */
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { newDb } from 'pg-mem';
import * as entities from '../src/database/entities';
import { InitialSchema1700000000000 } from '../src/database/migrations/1700000000000-InitialSchema';

type PgMemDb = ReturnType<typeof newDb>;

let dataSource: DataSource;
let db: PgMemDb;

function registerUuidFunctions(instance: PgMemDb): void {
  instance.public.registerFunction({ name: 'current_database', implementation: () => 'xstore_test' } as any);
  instance.public.registerFunction({ name: 'version', implementation: () => 'PostgreSQL 16.0' } as any);
  instance.public.registerFunction({ name: 'gen_random_uuid', implementation: () => randomUUID() } as any);
  instance.public.registerFunction({ name: 'uuid_generate_v4', implementation: () => randomUUID() } as any);
}

beforeAll(async () => {
  db = newDb({ autoCreateForeignKeyIndices: true });
  registerUuidFunctions(db);

  dataSource = await db.adapters.createTypeormConnection({
    type: 'postgres',
    entities: Object.values(entities),
    synchronize: true,
  } as any);
});

afterAll(async () => {
  await dataSource?.destroy();
});

describe('database schema (entities)', () => {
  it('initialises every entity', () => {
    expect(dataSource.isInitialized).toBe(true);
    expect(dataSource.entityMetadatas.length).toBeGreaterThanOrEqual(10);
  });

  it('persists a Marzban server with an encrypted password', async () => {
    const { encryptSecret } = require('../src/common/utils/crypto.util');
    const repo = dataSource.getRepository(entities.MarzbanServer);
    const server = repo.create({
      id: randomUUID(),
      name: 'Singapore',
      baseUrl: 'https://marzban.example.com',
      username: 'admin',
      passwordEncrypted: encryptSecret('panel-password', 'unit-test-encryption-key-32-chars'),
      location: 'SG',
      priority: 1,
    });
    const saved = await repo.save(server);

    expect(saved.id).toBeDefined();
    expect(saved.passwordEncrypted).not.toContain('panel-password');

    const reloaded = await repo.findOneBy({ id: saved.id });
    expect(reloaded?.status).toBe('ONLINE');
    expect(Number(reloaded?.activeUsers)).toBe(0);
    expect(reloaded?.isActive).toBe(true);
  });

  it('supports the full order -> subscription flow', async () => {
    const userRepo = dataSource.getRepository(entities.User);
    const user = await userRepo.save(
      userRepo.create({
        id: randomUUID(),
        email: 'buyer@example.com',
        name: 'Buyer',
        passwordHash: 'bcrypt-hash',
        role: 'USER',
      }),
    );

    const productRepo = dataSource.getRepository(entities.Product);
    const product = await productRepo.save(
      productRepo.create({
        id: randomUUID(),
        slug: 'pro-1-bulan',
        name: 'Pro 1 Bulan',
        priceIdr: 69000,
        durationDays: 30,
        dataLimitGb: 100,
        features: ['a', 'b'],
      }),
    );

    const serverRepo = dataSource.getRepository(entities.MarzbanServer);
    const server = await serverRepo.save(
      serverRepo.create({
        id: randomUUID(),
        name: 'Jakarta',
        baseUrl: 'https://marzban-jkt.example.com',
        username: 'admin',
        passwordEncrypted: 'envelope',
      }),
    );

    const orderRepo = dataSource.getRepository(entities.Order);
    const order = await orderRepo.save(
      orderRepo.create({
        id: randomUUID(),
        orderNumber: 'XST-TEST-0001',
        userId: user.id,
        productId: product.id,
        serverId: server.id,
        amountIdr: 69000,
        status: 'PENDING',
        bayarInvoiceId: 'BAYAR-1',
        paymentUrl: 'https://www.bayar.gg/pay?invoice=BAYAR-1',
      }),
    );

    const subscriptionRepo = dataSource.getRepository(entities.Subscription);
    const subscription = await subscriptionRepo.save(
      subscriptionRepo.create({
        id: randomUUID(),
        userId: user.id,
        orderId: order.id,
        productId: product.id,
        serverId: server.id,
        marzbanUsername: 'xstore_test_0001',
        subscriptionUrl: 'https://sub.example.com/abc',
        dataLimitBytes: 100 * 1024 ** 3,
        expireAt: new Date(Date.now() + 30 * 86400_000),
      }),
    );

    const loaded = await orderRepo.findOne({
      where: { id: order.id },
      relations: { user: true, product: true, server: true },
    });
    expect(loaded?.user.email).toBe('buyer@example.com');
    expect(loaded?.product.slug).toBe('pro-1-bulan');
    expect(loaded?.server.name).toBe('Jakarta');
    expect(Number(subscription.usedTrafficBytes)).toBe(0);

    const auditRepo = dataSource.getRepository(entities.AuditLog);
    await auditRepo.save(
      auditRepo.create({ id: randomUUID(), action: 'ORDER_CREATED', entity: 'Order', entityId: order.id }),
    );
    expect(await auditRepo.count()).toBe(1);

    const apiKeyRepo = dataSource.getRepository(entities.ApiKey);
    await apiKeyRepo.save(
      apiKeyRepo.create({
        id: randomUUID(),
        provider: 'BAYARGG',
        keyEncrypted: 'envelope',
        lastUpdatedByEmail: 'admin@example.com',
      }),
    );
    expect((await apiKeyRepo.find()).length).toBe(1);

    const settingsRepo = dataSource.getRepository(entities.Setting);
    await settingsRepo.save(settingsRepo.create({ key: 'site.name', value: 'XStore' }));
    expect((await settingsRepo.findOneBy({ key: 'site.name' }))?.value).toBe('XStore');
  });

  it('enforces the unique email constraint', async () => {
    const repo = dataSource.getRepository(entities.User);
    await repo.save(
      repo.create({ id: randomUUID(), email: 'dupe@example.com', name: 'Dupe', passwordHash: 'x', role: 'USER' }),
    );
    await expect(
      repo.save(
        repo.create({ id: randomUUID(), email: 'dupe@example.com', name: 'Dupe2', passwordHash: 'y', role: 'USER' }),
      ),
    ).rejects.toThrow();
  });
});

describe('initial migration', () => {
  it('creates every table when executed against PostgreSQL', async () => {
    // Fresh database WITHOUT synchronize: the migration must build the schema.
    const migrationDb = newDb();
    registerUuidFunctions(migrationDb);
    const migrationConnection = await migrationDb.adapters.createTypeormConnection({
      type: 'postgres',
      name: 'migration_test',
      synchronize: false,
    } as any);

    // pg-mem cannot create extensions - skip that one statement (no-op on PG16
    // where gen_random_uuid() is built in).
    const runner = migrationConnection.createQueryRunner();
    const originalQuery = runner.query.bind(runner);
    runner.query = (async (query: string, ...rest: unknown[]) => {
      if (/CREATE EXTENSION/i.test(query)) return [] as any;
      return (originalQuery as any)(query, ...rest);
    }) as any;

    const migration = new InitialSchema1700000000000();
    await expect(migration.up(runner)).resolves.not.toThrow();

    // Every table from the entities must exist and be usable.
    const tables = [
      'users',
      'refresh_tokens',
      'products',
      'marzban_servers',
      'orders',
      'payments',
      'subscriptions',
      'api_keys',
      'settings',
      'audit_logs',
    ];
    for (const table of tables) {
      const rows = await runner.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`);
      expect(rows.length).toBeGreaterThan(0);
    }

    await runner.release();
    await migrationConnection.destroy();
  });
});
