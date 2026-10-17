import { Column, CreateDateColumn, Entity, Index, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';

@Entity('products')
export class Product extends UuidEntity {

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160 })
  slug: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Price in IDR (integer rupiah - no floating point money). */
  @Column({ type: 'bigint' })
  priceIdr: number;

  @Column({ type: 'int' })
  durationDays: number;

  /** Traffic allowance in GB; null = unlimited. */
  @Column({ type: 'int', nullable: true })
  dataLimitGb: number | null;

  /** Marketing bullets shown on the catalog page. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  features: string[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
