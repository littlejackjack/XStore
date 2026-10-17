import { Column, CreateDateColumn, Entity, Index } from 'typeorm';
import { UuidEntity } from './base.entity';

/** Append-only trail of every sensitive configuration change. */
@Entity('audit_logs')
export class AuditLog extends UuidEntity {

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'action',})
  action: string;

  @Column({ type: 'varchar', length: 64, name: 'entity',})
  entity: string;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'entity_id',})
  entityId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'actor_id',})
  actorId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'actor_email',})
  actorEmail: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'metadata',})
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'ip',})
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;
}
