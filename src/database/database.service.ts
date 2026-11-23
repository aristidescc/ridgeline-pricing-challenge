import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quotes (
  id             TEXT PRIMARY KEY,
  rfq_id         TEXT NOT NULL,
  customer_id    TEXT NOT NULL,
  status         TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  line_signature TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  received_at    TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  approver_id    TEXT,
  specialist_id  TEXT,
  duplicate_of   TEXT,
  draft          TEXT NOT NULL,
  evaluation     TEXT
);
CREATE INDEX IF NOT EXISTS quotes_rfq ON quotes (rfq_id);
CREATE INDEX IF NOT EXISTS quotes_status ON quotes (status);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  at          TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log (entity_id);
-- Append-only: the database itself refuses edits and deletes of audit rows.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

/**
 * STUB: local SQLite file for quotes, approvals and the audit log — prod: managed Postgres
 * (point-in-time recovery, audit table with revoked UPDATE/DELETE grants).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.logger.log(`app store ready at ${path}`);
  }

  /** Runs fn atomically: state change + audit row commit together or not at all. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
