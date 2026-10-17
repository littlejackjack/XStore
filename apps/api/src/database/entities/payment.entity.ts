import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { UuidEntity } from './base.entity';
import { Order } from './order.entity';

/** Immutable record of every payment event (webhook or polling result). */
@Entity('payments')
export class Payment extends UuidEntity {

  @Index()
  @Column({ type: 'uuid', name: 'order_id',})
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'varchar', length: 32, default: 'BAYARGG', name: 'provider',})
  provider: string;

  @Column({ type: 'varchar', length: 128, name: 'invoice_id',})
  invoiceId: string;

  @Column({ type: 'bigint', name: 'amount',})
  amount: number;

  @Column({ type: 'varchar', length: 32, name: 'status',})
  status: string;

  /** Raw provider payload - invaluable for dispute resolution. */
  @Column({ type: 'jsonb', nullable: true, name: 'raw_payload',})
  rawPayload: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;
}
