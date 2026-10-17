import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for XStore.
 *
 * Column names follow TypeORM's default snake_case naming strategy and match
 * the entity decorators exactly, so `DB_SYNC=false` deployments can run this
 * migration instead of letting TypeORM create tables implicitly.
 *
 * Run with:  npm run migration:run
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "name" varchar(120) NOT NULL,
        "role" varchar(20) NOT NULL DEFAULT 'USER',
        "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_email" ON "users" ("email")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz NULL,
        "user_agent" varchar(255) NULL,
        "ip" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slug" varchar(160) NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text NULL,
        "price_idr" bigint NOT NULL,
        "duration_days" int NOT NULL,
        "data_limit_gb" int NULL,
        "features" jsonb NOT NULL DEFAULT '[]',
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_products_slug" ON "products" ("slug")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marzban_servers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "base_url" varchar(255) NOT NULL,
        "username" varchar(120) NOT NULL,
        "password_encrypted" text NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'ONLINE',
        "active_users" int NOT NULL DEFAULT 0,
        "max_capacity" int NULL,
        "location" varchar(120) NULL,
        "priority" int NOT NULL DEFAULT 0,
        "notes" text NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "last_checked_at" timestamptz NULL,
        "last_error" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_marzban_servers_base_url" ON "marzban_servers" ("base_url")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_number" varchar(32) NOT NULL,
        "user_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "server_id" uuid NOT NULL,
        "amount_idr" bigint NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'PENDING',
        "bayar_invoice_id" varchar(128) NULL,
        "payment_url" text NULL,
        "paid_at" timestamptz NULL,
        "failure_reason" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_orders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_orders_product" FOREIGN KEY ("product_id") REFERENCES "products"("id"),
        CONSTRAINT "FK_orders_server" FOREIGN KEY ("server_id") REFERENCES "marzban_servers"("id")
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orders_order_number" ON "orders" ("order_number")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orders_bayar_invoice_id" ON "orders" ("bayar_invoice_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_orders_user_id" ON "orders" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL DEFAULT 'BAYARGG',
        "invoice_id" varchar(128) NOT NULL,
        "amount" bigint NOT NULL,
        "status" varchar(32) NOT NULL,
        "raw_payload" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_payments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payments_order_id" ON "payments" ("order_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "server_id" uuid NOT NULL,
        "marzban_username" varchar(120) NOT NULL,
        "subscription_url" text NULL,
        "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
        "data_limit_bytes" bigint NULL,
        "used_traffic_bytes" bigint NOT NULL DEFAULT 0,
        "expire_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_subscriptions_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_subscriptions_product" FOREIGN KEY ("product_id") REFERENCES "products"("id"),
        CONSTRAINT "FK_subscriptions_server" FOREIGN KEY ("server_id") REFERENCES "marzban_servers"("id")
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_subscriptions_user_id" ON "subscriptions" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "api_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "key_encrypted" text NOT NULL,
        "webhook_secret_encrypted" text NULL,
        "last_updated_by" uuid NULL,
        "last_updated_by_email" varchar(255) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_api_keys_provider" ON "api_keys" ("provider")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settings" (
        "key" varchar(120) PRIMARY KEY,
        "value" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "action" varchar(64) NOT NULL,
        "entity" varchar(64) NOT NULL,
        "entity_id" varchar(128) NULL,
        "actor_id" uuid NULL,
        "actor_email" varchar(255) NULL,
        "metadata" jsonb NULL,
        "ip" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'audit_logs',
      'settings',
      'api_keys',
      'subscriptions',
      'payments',
      'orders',
      'marzban_servers',
      'products',
      'refresh_tokens',
      'users',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
