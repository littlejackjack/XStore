import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';
import { MarzbanServer } from './marzban-server.entity';
import { Order } from './order.entity';
import { Product } from './product.entity';
import { User } from './user.entity';

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'DEPLETED';

@Entity('subscriptions')
export class Subscription extends UuidEntity {

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'uuid' })
  serverId: string;

  @ManyToOne(() => MarzbanServer)
  @JoinColumn({ name: 'serverId' })
  server: MarzbanServer;

  /** Username created on the Marzban panel. */
  @Column({ type: 'varchar', length: 120 })
  marzbanUsername: string;

  /** Subscription link returned by Marzban for VPN clients. */
  @Column({ type: 'text', nullable: true })
  subscriptionUrl: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: SubscriptionStatus;

  @Column({ type: 'bigint', nullable: true })
  dataLimitBytes: number | null;

  @Column({ type: 'bigint', default: 0 })
  usedTrafficBytes: number;

  @Column({ type: 'timestamptz', nullable: true })
  expireAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
