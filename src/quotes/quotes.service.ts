import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { lowConfidenceFlags, routeQuote } from '../approval/approval.rules.js';
import { AuditService, type AuditRow } from '../audit/audit.service.js';
import { Clock, localDate } from '../common/clock.js';
import type { Draft, ReviewFlag } from '../common/domain.types.js';
import type { User } from '../common/users.directory.js';
import {
  APPROVAL_RULES,
  type ApprovalRules,
} from '../config/approval-rules.js';
import { DatabaseService } from '../database/database.service.js';
import {
  priceQuote,
  reportingFreshnessFlags,
} from '../pricing/pricing.rules.js';
import { ReportingRepository } from '../reporting/reporting.repository.js';
import { StockClient } from '../stock/stock.client.js';
import { stockFlags } from '../stock/stock.rules.js';
import type { QuoteRecord, QuoteStatus } from './quote.types.js';
import { QuotesRepository } from './quotes.repository.js';
import { decide, findDuplicate, lineSignature } from './quotes.rules.js';

const byLine = (a: ReviewFlag, b: ReviewFlag) =>
  (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);

/** Orchestrates intake → price → stock → route, the approval workflow, persistence and audit. */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @Inject(QuotesRepository) private readonly quotes: QuotesRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StockClient) private readonly stock: StockClient,
    @Inject(ReportingRepository)
    private readonly reporting: ReportingRepository,
    @Inject(APPROVAL_RULES) private readonly rules: ApprovalRules,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * Intake from the extraction service. Idempotent on draft_id: a replay of the same draft
   * returns the stored quote instead of creating a second approval request.
   */
  async intake(
    draft: Draft,
    actor: User,
  ): Promise<{ created: boolean; quote: QuoteRecord }> {
    const existing = this.quotes.findById(draft.draft_id);
    if (existing) return { created: false, quote: existing };

    const customer = this.reporting.customer(draft.customer_id);
    if (!customer) {
      throw new BadRequestException(
        `customer ${draft.customer_id} not found in reporting database`,
      );
    }
    const now = this.clock.now();
    const base = {
      id: draft.draft_id,
      rfqId: draft.rfq_id,
      customerId: draft.customer_id,
      version: 1,
      lineSignature: lineSignature(draft.lines),
      createdAt: draft.created_at,
      receivedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      specialistId: null,
      draft,
    };

    const duplicateOf = findDuplicate(
      draft,
      this.quotes.originalsForRfq(draft.rfq_id),
      this.rules.duplicateWindowHours,
    );
    if (duplicateOf) {
      const quote: QuoteRecord = {
        ...base,
        status: 'duplicate',
        approverId: null,
        duplicateOf,
        evaluation: null,
      };
      return this.persistNew(quote, actor, 'draft_duplicate_detected', {
        duplicate_of: duplicateOf,
      });
    }

    const today = localDate(now, this.rules.businessTimezone);
    const pricing = priceQuote(draft, this.reporting, today);
    // Stock is read before the transaction; the client never throws (unavailable is a result).
    const stockResult = await this.stock.getStock(
      draft.lines.map((l) => l.part_number),
    );
    const stock = stockFlags(
      draft.lines,
      stockResult,
      now,
      this.rules.stockMaxAgeHours,
    );
    const routing = routeQuote(
      {
        effectiveDiscountPct: pricing.effectiveDiscountPct,
        netCents: pricing.netCents,
        region: customer.region,
      },
      this.rules,
      this.reporting.approvers,
      today,
    );
    const flags = [
      ...lowConfidenceFlags(draft.lines, this.rules.lowConfidenceThreshold),
      ...pricing.flags,
      ...stock.flags,
      ...reportingFreshnessFlags(
        this.reporting.exportedAt,
        now,
        this.rules.reportingMaxAgeHours,
      ),
      ...routing.flags,
    ].sort(byLine);

    const quote: QuoteRecord = {
      ...base,
      // Policy "Always" §1: every quote starts with a specialist, even when no manager is needed.
      status: 'pending_specialist',
      approverId: routing.approverId,
      duplicateOf: null,
      evaluation: {
        region: customer.region,
        lines: pricing.lines,
        listCents: pricing.listCents,
        netCents: pricing.netCents,
        effectiveDiscountPct: pricing.effectiveDiscountPct,
        tier: routing.tier,
        approverId: routing.approverId,
        primaryApproverId: routing.primaryApproverId,
        stockStatus: stock.status,
        flags,
        evaluatedAt: now.toISOString(),
      },
    };
    return this.persistNew(quote, actor, 'quote_created', {
      tier: routing.tier,
      approver_id: routing.approverId,
      primary_approver_id: routing.primaryApproverId,
      net_cents: pricing.netCents,
      effective_discount_pct: pricing.effectiveDiscountPct,
      stock_status: stock.status,
      flags: flags.length,
    });
  }

  list(filter: { status?: QuoteStatus; approverId?: string }): QuoteRecord[] {
    return this.quotes.list(filter);
  }

  get(id: string): QuoteRecord {
    const q = this.quotes.findById(id);
    if (!q) throw new NotFoundException(`quote ${id} not found`);
    return q;
  }

  history(id: string): AuditRow[] {
    this.get(id);
    return this.audit.forEntity(id);
  }

  approve(id: string, actor: User, comment?: string): QuoteRecord {
    return this.applyDecision(id, actor, 'approve', { comment });
  }

  reject(id: string, actor: User, reason: string): QuoteRecord {
    return this.applyDecision(id, actor, 'reject', { reason });
  }

  /**
   * STUB: quote editing — prod: apply the field changes, re-run priceQuote → stockFlags →
   * routeQuote on the edited draft, audit each field's before/after value (policy §12), bump
   * the version, and send the quote back to pending_specialist (prior sign-offs are void).
   */
  edit(id: string): never {
    this.get(id);
    throw new NotImplementedException(
      'Quote editing is stubbed. Production: edit → reprice → re-check stock → reroute → audit before/after values → back to pending_specialist.',
    );
  }

  private applyDecision(
    id: string,
    actor: User,
    action: 'approve' | 'reject',
    details: Record<string, unknown>,
  ): QuoteRecord {
    const quote = this.get(id);
    const d = decide(quote, actor, action, this.rules.roles.specialist);
    if (!d.ok) {
      throw d.error === 'forbidden'
        ? new ForbiddenException(d.message)
        : new ConflictException(d.message);
    }
    const at = this.clock.now();
    this.database.transaction(() => {
      const changed = this.quotes.transition(
        id,
        quote.status,
        quote.version,
        d.to,
        {
          specialistId: d.step === 'specialist' ? actor.id : undefined,
          updatedAt: at.toISOString(),
        },
      );
      // Someone else changed the quote between our read and write: no double approval.
      if (!changed) {
        throw new ConflictException(
          `quote ${id} was modified concurrently; reload and retry`,
        );
      }
      this.audit.record({
        actor: actor.id,
        action: `${d.step}_${action === 'approve' ? 'approved' : 'rejected'}`,
        entityId: id,
        fromStatus: quote.status,
        toStatus: d.to,
        at,
        details: {
          role: actor.role,
          approver_id: quote.approverId,
          ...details,
        },
      });
    });
    if (d.to === 'approved') {
      // STUB: release to customer — prod: write a quote.approved event to an outbox; a
      // downstream sender delivers it. This service never writes to SAP.
      this.logger.log(`quote ${id} approved by ${actor.id}; ready to send`);
    }
    return this.get(id);
  }

  private persistNew(
    quote: QuoteRecord,
    actor: User,
    action: string,
    details: Record<string, unknown>,
  ): { created: boolean; quote: QuoteRecord } {
    try {
      this.database.transaction(() => {
        this.quotes.insert(quote);
        this.audit.record({
          actor: actor.id,
          action,
          entityId: quote.id,
          fromStatus: null,
          toStatus: quote.status,
          at: new Date(quote.receivedAt),
          details,
        });
      });
    } catch (err) {
      // Concurrent replay of the same draft_id: the first insert wins; return it.
      if (
        err instanceof Database.SqliteError &&
        err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
      ) {
        return { created: false, quote: this.get(quote.id) };
      }
      throw err;
    }
    return { created: true, quote };
  }
}
