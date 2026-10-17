import { Column, CreateDateColumn, Entity, Index, OneToMany, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';
import type { Order } from './order.entity';
import type { Subscription } from './subscription.entity';

export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

@Entity('users')
export class User extends UuidEntity {

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, name: 'email',})
  email: string;

  /** bcrypt hash - the plain password is never stored. */
  @Column({ type: 'varchar', length: 255, select: false, name: 'password_hash',})
  passwordHash: string;

  @Column({ type: 'varchar', length: 120, name: 'name',})
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'USER', name: 'role',})
  role: UserRole;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE', name: 'status',})
  status: UserStatus;

  /** Set once the email address is confirmed with a one-time code. */
  @Column({ type: 'boolean', default: false, name: 'email_verified',})
  emailVerified: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'email_verified_at',})
  emailVerifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at',})
  updatedAt: Date;

  @OneToMany('Order', 'user')
  orders: Order[];

  @OneToMany('Subscription', 'user')
  subscriptions: Subscription[];
}
