import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Writes the append-only audit trail. Never throws into the request path -
 * a failed audit write is logged loudly but must not break the operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dataSource: DataSource) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      const repository = this.dataSource.getRepository(AuditLog);
      await repository.save(
        repository.create({
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          metadata: this.sanitise(entry.metadata ?? null),
          ip: entry.ip ?? null,
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to write audit log (${entry.action}): ${(error as Error).message}`);
    }
  }

  /** Strips anything that looks like a secret before persisting metadata. */
  private sanitise(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lower = key.toLowerCase();
      if (lower.includes('key') || lower.includes('secret') || lower.includes('password') || lower.includes('token')) {
        redacted[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        redacted[key] = JSON.parse(JSON.stringify(value));
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
}
