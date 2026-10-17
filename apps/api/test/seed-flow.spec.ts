/**
 * Regression test for the first-boot seed path used by the API container
 * entrypoint and by CI (migrate -> seed). Verifies that every write in
 * seed.ts works against the migrated schema, including the UUID generation
 * that relies on the entity listener (i.e. `save(create())`, not `insert()`).
 */
import { randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import * as entities from '../src/database/entities';
import { InitialSchema1700000000000 } from '../src/database/migrations/1700000000000-InitialSchema';
import { EmailOtpAndExpiryReminders1700000100000 } from '../src/database/migrations/1700000100000-EmailOtpAndExpiryReminders';
import { hashPassword } from '../src/modules/auth/password.util';

let dataSource: DataSource;

beforeAll(async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: 'current_database', implementation: () => 'xstore' });
  db.public.registerFunction({ name: 'version', implementation: () => 'PostgreSQL 16.0' });
  db.public.registerFunction({ name: 'gen_random_uuid', implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'uuid_generate_v4', implementation: () => randomUUID() });

  dataSource = await db.adapters.createTypeormConnection({
    type: 'postgres',
    name: 'seed_flow',
    entities: Object.values(entities),
    synchronize: false, // schema comes from the migration below
  } as any);

  const runner = dataSource.createQueryRunner();
  const original = runner.query.bind(runner);
  runner.query = (async (query: string, ...rest: unknown[]) =>
    /CREATE EXTENSION/i.test(query) ? ([] as any) : (original as any)(query, ...rest)) as any;
  await new InitialSchema1700000000000().up(runner);
  await new EmailOtpAndExpiryReminders1700000100000().up(runner);
});

afterAll(async () => {
  try {
    await dataSource?.destroy();
  } catch {
    /* already closed */
  }
});

describe('migration/entity parity', () => {
  it('every entity column exists in the migrated schema (snake_case)', async () => {
    const mismatches: string[] = [];

    for (const metadata of dataSource.entityMetadatas) {
      const rows = (await dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [metadata.tableName],
      )) as Array<{ column_name: string }>;
      const actual = new Set(rows.map((row) => row.column_name));

      for (const column of metadata.columns) {
        if (!actual.has(column.databaseName)) {
          mismatches.push(`${metadata.tableName}.${column.databaseName} (property: ${column.propertyName})`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('migrated tables match the entity table names', async () => {
    const rows = (await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )) as Array<{ table_name: string }>;
    const tables = new Set(rows.map((row) => row.table_name));
    const expected = dataSource.entityMetadatas.map((metadata) => metadata.tableName);

    for (const table of expected) {
      expect(tables.has(table)).toBe(true);
    }
  });
});

describe('seed flow (migrated schema)', () => {
  it('creates the super admin', async () => {
    const repo = dataSource.getRepository(entities.User);
    const admin = repo.create({
      id: randomUUID(),
      email: 'admin@example.com',
      name: 'Super Admin',
      passwordHash: await hashPassword('ChangeMe123!', 4),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    const saved = await repo.save(admin);
    expect(saved.id).toBeDefined();
    expect(saved.role).toBe('SUPER_ADMIN');
  });

  it('creates demo products with generated UUIDs (save + create, not insert)', async () => {
    const repo = dataSource.getRepository(entities.Product);
    const products = [
      repo.create({ slug: 'a', name: 'A', priceIdr: 25000, durationDays: 30, dataLimitGb: 50, features: ['x'] }),
      repo.create({ slug: 'b', name: 'B', priceIdr: 69000, durationDays: 90, dataLimitGb: 200, features: [] }),
      repo.create({ slug: 'c', name: 'C', priceIdr: 199000, durationDays: 365, dataLimitGb: null, features: [] }),
    ];
    const saved = await repo.save(products);

    expect(saved).toHaveLength(3);
    for (const product of saved) {
      expect(product.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(await repo.count()).toBe(3);
  });

  it('creates default settings', async () => {
    const repo = dataSource.getRepository(entities.Setting);
    await repo.save([
      repo.create({ key: 'site.name', value: 'XStore' }),
      repo.create({ key: 'order.autoProvision', value: true }),
    ]);
    expect((await repo.findOneBy({ key: 'site.name' }))?.value).toBe('XStore');
  });
});
