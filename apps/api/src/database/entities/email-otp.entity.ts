import { Column, CreateDateColumn, Entity, Index } from 'typeorm';
import { UuidEntity } from './base.entity';

export type OtpPurpose = 'LOGIN' | 'EMAIL_VERIFICATION';

/**
 * One-time email codes (login 2FA / email verification).
 *
 * The 6-digit code is NEVER stored in plain text - only a bcrypt hash, so a
 * database dump cannot be used to authenticate. Codes expire after 10 minutes
 * and are single-use (`consumed_at`).
 */
@Entity('email_otps')
export class EmailOtp extends UuidEntity {
  @Index()
  @Column({ type: 'varchar', length: 255, name: 'email',})
  email: string;

  @Column({ type: 'varchar', length: 32, default: 'LOGIN', name: 'purpose',})
  purpose: OtpPurpose;

  /** bcrypt hash of the code (never the code itself). */
  @Column({ type: 'varchar', length: 255, name: 'code_hash',})
  codeHash: string;

  /** Failed verification attempts - the code dies after 5. */
  @Column({ type: 'int', default: 0, name: 'attempts',})
  attempts: number;

  @Column({ type: 'timestamptz', name: 'expires_at',})
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'consumed_at',})
  consumedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'ip',})
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;
}
