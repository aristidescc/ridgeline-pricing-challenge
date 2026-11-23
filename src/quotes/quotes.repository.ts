import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { PriorDraft } from './quotes.rules.js';
import type { QuoteRecord, QuoteStatus } from './quote.types.js';

interface Row {
  id: string;
  rfq_id: string;
  customer_id: string;
  status: QuoteStatus;
  version: number;
  line_signature: string;
  created_at: string;
  received_at: string;
  updated_at: string;
  approver_id: string | null;
  specialist_id: string | null;
  duplicate_of: string | null;
  draft: string;
  evaluation: string | null;
}

const toRecord = (r: Row): QuoteRecord => ({
  id: r.id,
  rfqId: r.rfq_id,
  customerId: r.customer_id,
  status: r.status,
  version: r.version,
  lineSignature: r.line_signature,
  createdAt: r.created_at,
  receivedAt: r.received_at,
  updatedAt: r.updated_at,
  approverId: r.approver_id,
  specialistId: r.specialist_id,
  duplicateOf: r.duplicate_of,
  draft: JSON.parse(r.draft) as QuoteRecord['draft'],
  evaluation: r.evaluation
    ? (JSON.parse(r.evaluation) as QuoteRecord['evaluation'])
    : null,
});

@Injectable()
export class QuotesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  insert(q: QuoteRecord): void {
    this.database.db
      .prepare(
        `INSERT INTO quotes (id, rfq_id, customer_id, status, version, line_signature, created_at,
           received_at, updated_at, approver_id, specialist_id, duplicate_of, draft, evaluation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        q.id,
        q.rfqId,
        q.customerId,
        q.status,
        q.version,
        q.lineSignature,
        q.createdAt,
        q.receivedAt,
        q.updatedAt,
        q.approverId,
        q.specialistId,
        q.duplicateOf,
        JSON.stringify(q.draft),
        q.evaluation ? JSON.stringify(q.evaluation) : null,
      );
  }

  findById(id: string): QuoteRecord | undefined {
    const row = this.database.db
      .prepare('SELECT * FROM quotes WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }

  /** Non-duplicate drafts for the same RFQ: candidates for duplicate detection. */
  originalsForRfq(rfqId: string): PriorDraft[] {
    return (
      this.database.db
        .prepare(
          `SELECT id, rfq_id, line_signature, created_at FROM quotes
           WHERE rfq_id = ? AND status <> 'duplicate'`,
        )
        .all(rfqId) as Pick<
        Row,
        'id' | 'rfq_id' | 'line_signature' | 'created_at'
      >[]
    ).map((r) => ({
      id: r.id,
      rfqId: r.rfq_id,
      lineSignature: r.line_signature,
      createdAt: r.created_at,
    }));
  }

  list(filter: { status?: QuoteStatus; approverId?: string }): QuoteRecord[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.status) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.approverId) {
      where.push('approver_id = ?');
      args.push(filter.approverId);
    }
    const sql = `SELECT * FROM quotes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`;
    return (this.database.db.prepare(sql).all(...args) as Row[]).map(toRecord);
  }

  /**
   * Guarded state transition (optimistic concurrency): only succeeds if the quote is still in
   * the expected status and version. Returns false when someone else got there first.
   */
  transition(
    id: string,
    from: QuoteStatus,
    version: number,
    to: QuoteStatus,
    patch: { specialistId?: string; updatedAt: string },
  ): boolean {
    const res = this.database.db
      .prepare(
        `UPDATE quotes SET status = ?, version = version + 1, updated_at = ?,
           specialist_id = COALESCE(?, specialist_id)
         WHERE id = ? AND status = ? AND version = ?`,
      )
      .run(to, patch.updatedAt, patch.specialistId ?? null, id, from, version);
    return res.changes === 1;
  }
}
