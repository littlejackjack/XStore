import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Email OTP codes (login 2FA / email verification) + subscription expiry
 * reminder bookkeeping.
 *
 * Applied automatically by the API container entrypoint on boot
 * (`node dist/database/run-migrations.js`), and by CI before the smoke test.
 */
export class EmailOtpAndExpiryReminders1700000100000 implements MigrationInterface {
  name = 'EmailOtpAndExpiryReminders1700000100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_otps" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "purpose" varchar(32) NOT NULL DEFAULT 'LOGIN',
        "code_hash" varchar(255) NOT NULL,
        "attempts" int NOT NULL DEFAULT 0,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz NULL,
        "ip" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_otps_email" ON "email_otps" ("email", "purpose", "created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "expiry_reminder_sent_at" timestamptz NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamptz NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "expiry_reminder_sent_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_email_otps_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_otps"`);
  }
}
