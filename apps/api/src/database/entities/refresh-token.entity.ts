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
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
