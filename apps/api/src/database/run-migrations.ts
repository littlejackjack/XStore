/**
 * Runs pending migrations. Executed by the API container entrypoint on boot.
 * Exits non-zero on failure so `docker compose up` surfaces the error.
 */
import { AppDataSource } from './data-source';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const executed = await AppDataSource.runMigrations({ transaction: 'each' });
    if (executed.length === 0) {
      console.log('[migrations] database is up to date');
    } else {
      console.log(`[migrations] executed ${executed.length} migration(s):`);
      for (const migration of executed) console.log(`  - ${migration.name}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('[migrations] failed:', error);
  process.exit(1);
});
