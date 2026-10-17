import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Key/value store for editable site settings (cached in Redis). */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 120 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
