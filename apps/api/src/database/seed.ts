/**
 * Idempotent first-boot seed.
 * - creates the SUPER_ADMIN account from env (SUPER_ADMIN_EMAIL/PASSWORD)
 * - creates default site settings
 * - optionally creates demo products when no product exists yet
 *
 * Safe to run repeatedly: it never overwrites existing rows.
 */
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { Setting } from './entities/setting.entity';
import { Product } from './entities/product.entity';
import { hashPassword } from '../modules/auth/password.util';

const DEFAULT_SETTINGS: Array<[string, unknown]> = [
  ['site.name', 'XStore'],
  ['site.tagline', 'Premium VPN subscriptions, delivered instantly.'],
  ['site.currency', 'IDR'],
  ['site.registrationEnabled', true],
  ['site.supportContact', ''],
  ['order.autoProvision', true],
];

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const { configuration } = await import('../config/configuration');
  const config = configuration();

  const userRepository = AppDataSource.getRepository(User);
  const adminEmail = (process.env.SUPER_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let admin = await userRepository.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = userRepository.create({
      email: adminEmail,
      name: 'Super Admin',
      passwordHash: await hashPassword(adminPassword, config.security.bcryptRounds),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    await userRepository.save(admin);
    console.log(`[seed] created super admin: ${adminEmail}`);
  } else if (admin.role !== 'SUPER_ADMIN') {
    admin.role = 'SUPER_ADMIN';
    await userRepository.save(admin);
    console.log(`[seed] promoted existing user to SUPER_ADMIN: ${adminEmail}`);
  } else {
    console.log(`[seed] super admin already exists: ${adminEmail}`);
  }

  const settingRepository = AppDataSource.getRepository(Setting);
  for (const [key, value] of DEFAULT_SETTINGS) {
    const existing = await settingRepository.findOneBy({ key });
    if (!existing) {
      await settingRepository.save({ key, value } as Setting);
    }
  }
  console.log('[seed] default settings ensured');

  const productRepository = AppDataSource.getRepository(Product);
  const productCount = await productRepository.count();
  if (productCount === 0) {
    // `save(create())` - not `insert()` - so the @BeforeInsert hook on
    // UuidEntity assigns the primary key.
    await productRepository.save([
      productRepository.create({
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
      productRepository.create({
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
      productRepository.create({
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
    console.log('[seed] created demo products');
  }

  await AppDataSource.destroy();
  console.log('[seed] done');
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
