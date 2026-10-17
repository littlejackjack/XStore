import { Column, CreateDateColumn, Entity, Index, UpdateDateColumn } from 'typeorm';
import { UuidEntity } from './base.entity';

@Entity('products')
export class Product extends UuidEntity {

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160, name: 'slug',})
  slug: string;

  @Column({ type: 'varchar', length: 160, name: 'name',})
  name: string;

  @Column({ type: 'text', nullable: true, name: 'description',})
  description: string | null;

  /** Price in IDR (integer rupiah - no floating point money). */
  @Column({ type: 'bigint', name: 'price_idr',})
  priceIdr: number;

  @Column({ type: 'int', name: 'duration_days',})
  durationDays: number;

  /** Traffic allowance in GB; null = unlimited. */
  @Column({ type: 'int', nullable: true, name: 'data_limit_gb',})
  dataLimitGb: number | null;

  /** Marketing bullets shown on the catalog page. */
  @Column({ type: 'jsonb', default: () => "'[]'", name: 'features',})
  features: string[];

  @Column({ type: 'boolean', default: true, name: 'is_active',})
  isActive: boolean;

  @Column({ type: 'int', default: 0, name: 'sort_order',})
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at',})
  updatedAt: Date;
}
