import { Column, CreateDateColumn, Entity, Index, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';

export type ApiKeyProvider = 'RESEND' | 'BAYARGG';

/**
 * Third-party credentials managed from the Admin Panel.
 * `keyEncrypted` / `webhookSecretEncrypted` store AES-256-GCM envelopes -
 * never plain text. Only SUPER_ADMIN may rotate them; every change is
 * written to the audit log by ApiKeysService.
 */
@Entity('api_keys')
export class ApiKey extends UuidEntity {

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'provider',})
  provider: ApiKeyProvider;

  @Column({ type: 'text', name: 'key_encrypted',})
  keyEncrypted: string;

  /** Bayar.gg webhook secret (whsec_...) used for HMAC verification. */
  @Column({ type: 'text', nullable: true, name: 'webhook_secret_encrypted',})
  webhookSecretEncrypted: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'last_updated_by',})
  lastUpdatedBy: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'last_updated_by_email',})
  lastUpdatedByEmail: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at',})
  updatedAt: Date;
}
