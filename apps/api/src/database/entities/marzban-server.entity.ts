import { Column, CreateDateColumn, Entity, Index, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';

export type ServerStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';

/**
 * A Marzban panel instance managed by this platform.
 * `passwordEncrypted` holds an AES-256-GCM envelope produced by crypto.util -
 * the plain password is never stored anywhere in the database.
 */
@Entity('marzban_servers')
export class MarzbanServer extends UuidEntity {

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  baseUrl: string;

  @Column({ type: 'varchar', length: 120 })
  username: string;

  /** AES-256-GCM envelope (see common/utils/crypto.util.ts). */
  @Column({ type: 'text' })
  passwordEncrypted: string;

  @Column({ type: 'varchar', length: 20, default: 'ONLINE' })
  status: ServerStatus;

  /** Users currently active on the panel, refreshed by the status worker. */
  @Column({ type: 'int', default: 0 })
  activeUsers: number;

  /** Optional hard cap; null = unlimited capacity. */
  @Column({ type: 'int', nullable: true })
  maxCapacity: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location: string | null;

  /** Lower value = shown first in checkout. */
  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Soft switch - disabled servers never appear at checkout. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
