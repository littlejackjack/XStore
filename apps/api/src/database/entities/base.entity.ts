import { BeforeInsert, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

/**
 * Base entity with an application-generated UUID primary key.
 *
 * Generating the id in the application (instead of relying on a database
 * DEFAULT) keeps inserts explicit, makes the schema portable across PostgreSQL
 * versions, and avoids a round-trip per insert.
 */
export abstract class UuidEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id',})
  id: string;

  @BeforeInsert()
  protected assignId(): void {
    if (!this.id) {
      this.id = randomUUID();
    }
  }
}
