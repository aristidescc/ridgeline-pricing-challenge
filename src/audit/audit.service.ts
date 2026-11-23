import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface AuditEntry {
  actor: string;
  action: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string | null;
  at: Date;
  details?: Record<string, unknown>;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  entity_id: string;
  from_status: string | null;
  to_status: string | null;
  at: string;
  details: Record<string, unknown>;
}

/** Append-only audit trail: there is deliberately no update or delete method. */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  record(e: AuditEntry): void {
    this.database.db
      .prepare(
        `INSERT INTO audit_log (actor, action, entity_id, from_status, to_status, at, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.actor,
        e.action,
        e.entityId,
        e.fromStatus,
        e.toStatus,
        e.at.toISOString(),
        JSON.stringify(e.details ?? {}),
      );
  }

  forEntity(entityId: string): AuditRow[] {
    return this.parse(
      this.database.db
        .prepare('SELECT * FROM audit_log WHERE entity_id = ? ORDER BY id')
        .all(entityId),
    );
  }

  all(): AuditRow[] {
    return this.parse(
      this.database.db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
    );
  }

  private parse(rows: unknown[]): AuditRow[] {
    return (rows as (Omit<AuditRow, 'details'> & { details: string })[]).map(
      (r) => ({
        ...r,
        details: JSON.parse(r.details) as Record<string, unknown>,
      }),
    );
  }
}
