import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';
import { Product } from './product.entity';
import { MarzbanServer } from './marzban-server.entity';
import { User } from './user.entity';

export type OrderStatus =
  | 'PENDING'
  | 'PAID'
  | 'PROVISIONING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

@Entity('orders')
export class Order extends UuidEntity {

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'order_number',})
  orderNumber: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id',})
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'product_id',})
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  /** Server chosen by the buyer at checkout. */
  @Column({ type: 'uuid', name: 'server_id',})
  serverId: string;

  @ManyToOne(() => MarzbanServer)
  @JoinColumn({ name: 'server_id' })
  server: MarzbanServer;

  @Column({ type: 'bigint', name: 'amount_idr',})
  amountIdr: number;

  @Column({ type: 'varchar', length: 20, default: 'PENDING', name: 'status',})
  status: OrderStatus;

  /** Bayar.gg invoice id returned by create-payment. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'bayar_invoice_id',})
  bayarInvoiceId: string | null;

  @Column({ type: 'text', nullable: true, name: 'payment_url',})
  paymentUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'paid_at',})
  paidAt: Date | null;

  @Column({ type: 'text', nullable: true, name: 'failure_reason',})
  failureReason: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at',})
  updatedAt: Date;
}
