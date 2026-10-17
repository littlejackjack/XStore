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
  @Column({ type: 'uuid', name: 'user_id',})
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'order_id',})
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'uuid', name: 'product_id',})
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'uuid', name: 'server_id',})
  serverId: string;

  @ManyToOne(() => MarzbanServer)
  @JoinColumn({ name: 'server_id' })
  server: MarzbanServer;

  /** Username created on the Marzban panel. */
  @Column({ type: 'varchar', length: 120, name: 'marzban_username',})
  marzbanUsername: string;

  /** Subscription link returned by Marzban for VPN clients. */
  @Column({ type: 'text', nullable: true, name: 'subscription_url',})
  subscriptionUrl: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE', name: 'status',})
  status: SubscriptionStatus;

  @Column({ type: 'bigint', nullable: true, name: 'data_limit_bytes',})
  dataLimitBytes: number | null;

  @Column({ type: 'bigint', default: 0, name: 'used_traffic_bytes',})
  usedTrafficBytes: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'expire_at',})
  expireAt: Date | null;

  /** Set when the "subscription expiring soon" email has been sent (dedupe). */
  @Column({ type: 'timestamptz', nullable: true, name: 'expiry_reminder_sent_at',})
  expiryReminderSentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at',})
  updatedAt: Date;
}
