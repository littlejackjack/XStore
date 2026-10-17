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
  @Column({ type: 'varchar', length: 32 })
  provider: ApiKeyProvider;

  @Column({ type: 'text' })
  keyEncrypted: string;

  /** Bayar.gg webhook secret (whsec_...) used for HMAC verification. */
  @Column({ type: 'text', nullable: true })
  webhookSecretEncrypted: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastUpdatedBy: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastUpdatedByEmail: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
