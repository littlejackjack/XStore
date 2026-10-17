import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { UuidEntity } from './base.entity';
import { User } from './user.entity';

/**
 * Refresh tokens are persisted as SHA-256 hashes so a database leak cannot be
 * replayed into valid sessions. Rotation is enforced: every refresh revokes
 * the previous token and issues a new one.
 */
@Entity('refresh_tokens')
export class RefreshToken extends UuidEntity {

  @Index()
  @Column({ type: 'uuid', name: 'user_id',})
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'token_hash',})
  tokenHash: string;

  @Column({ type: 'timestamptz', name: 'expires_at',})
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'revoked_at',})
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'user_agent',})
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'ip',})
  ip: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()', name: 'created_at',})
  createdAt: Date;
}
