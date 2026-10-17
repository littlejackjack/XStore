import { Column, CreateDateColumn, Entity, Index, OneToMany, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';
import type { Order } from './order.entity';
import type { Subscription } from './subscription.entity';

export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

@Entity('users')
export class User extends UuidEntity {

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** bcrypt hash - the plain password is never stored. */
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'USER' })
  role: UserRole;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: UserStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany('Order', 'user')
  orders: Order[];

  @OneToMany('Subscription', 'user')
  subscriptions: Subscription[];
}
