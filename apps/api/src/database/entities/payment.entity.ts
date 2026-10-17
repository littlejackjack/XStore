import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { UuidEntity } from './base.entity';
import { Order } from './order.entity';

/** Immutable record of every payment event (webhook or polling result). */
@Entity('payments')
export class Payment extends UuidEntity {

  @Index()
  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'varchar', length: 32, default: 'BAYARGG' })
  provider: string;

  @Column({ type: 'varchar', length: 128 })
  invoiceId: string;

  @Column({ type: 'bigint' })
  amount: number;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  /** Raw provider payload - invaluable for dispute resolution. */
  @Column({ type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
