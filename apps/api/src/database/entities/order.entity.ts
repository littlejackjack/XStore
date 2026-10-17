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
  @Column({ type: 'varchar', length: 32 })
  orderNumber: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product: Product;

  /** Server chosen by the buyer at checkout. */
  @Column({ type: 'uuid' })
  serverId: string;

  @ManyToOne(() => MarzbanServer)
  @JoinColumn({ name: 'serverId' })
  server: MarzbanServer;

  @Column({ type: 'bigint' })
  amountIdr: number;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: OrderStatus;

  /** Bayar.gg invoice id returned by create-payment. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  bayarInvoiceId: string | null;

  @Column({ type: 'text', nullable: true })
  paymentUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
