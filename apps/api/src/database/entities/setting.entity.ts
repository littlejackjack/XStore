import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Key/value store for editable site settings (cached in Redis). */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 120, name: 'key',})
  key: string;

  @Column({ type: 'jsonb', name: 'value',})
  value: unknown;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at',})
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at',})
  updatedAt: Date;
}
