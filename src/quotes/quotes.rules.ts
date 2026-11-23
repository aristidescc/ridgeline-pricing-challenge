import type { Draft, DraftLine } from '../common/domain.types.js';
import { hoursBetween } from '../common/clock.js';
import { centsToUsd, round2 } from '../pricing/pricing.rules.js';
import type { QuoteRecord, QuoteStatus, RoutingResult } from './quote.types.js';

/** Order-insensitive identity of a draft's lines: part, quantity and unit. */
export function lineSignature(lines: DraftLine[]): string {
  return lines
    .map(
      (l) =>
        `${l.part_number.trim().toUpperCase()}|${l.quantity}|${l.unit.trim().toUpperCase()}`,
    )
    .sort()
    .join(';');
}

export interface PriorDraft {
  id: string;
  rfqId: string;
  lineSignature: string;
  createdAt: string;
}

/**
 * Policy §11: "A draft with the same rfq_id and the same lines as a draft received in the
 * last 24 hours is a duplicate. Do not create a second approval request."
 * Returns the earliest matching original, or null.
 */
export function findDuplicate(
  draft: Draft,
  prior: PriorDraft[],
  windowHours: number,
): string | null {
  const sig = lineSignature(draft.lines);
  const created = new Date(draft.created_at);
  const match = prior
    .filter(
      (p) =>
        p.id !== draft.draft_id &&
        p.rfqId === draft.rfq_id &&
        p.lineSignature === sig,
    )
    .filter((p) => {
      const age = hoursBetween(new Date(p.createdAt), created);
      return age >= 0 && age <= windowHours;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return match[0]?.id ?? null;
}

export interface Actor {
  id: string;
  role: string;
}

export type Decision =
  | { ok: true; to: QuoteStatus; step: 'specialist' | 'approver' }
  | { ok: false; error: 'forbidden' | 'conflict'; message: string };

/**
 * Who may approve/reject right now. Authorization of the action itself lives here (and in
 * the service), not only in the guard: a specialist signs off first, then only the routed
 * approver (backup already applied) may decide.
 */
export function decide(
  quote: Pick<
    QuoteRecord,
    'status' | 'approverId' | 'evaluation' | 'specialistId'
  >,
  actor: Actor,
  action: 'approve' | 'reject',
  specialistRole: string,
): Decision {
  if (quote.status === 'pending_specialist') {
    if (actor.role !== specialistRole) {
      return {
        ok: false,
        error: 'forbidden',
        message: 'quote is awaiting quote specialist sign-off',
      };
    }
    if (action === 'reject')
      return { ok: true, to: 'rejected', step: 'specialist' };
    const needsApprover = quote.evaluation?.tier !== 'specialist_only';
    if (needsApprover && !quote.approverId) {
      // Never park a quote where nobody can decide it: specialist must reject or escalate manually.
      return {
        ok: false,
        error: 'conflict',
        message:
          'no available approver for this quote; manual assignment required',
      };
    }
    return {
      ok: true,
      to: needsApprover ? 'pending_approver' : 'approved',
      step: 'specialist',
    };
  }
  if (quote.status === 'pending_approver') {
    if (actor.id !== quote.approverId) {
      return {
        ok: false,
        error: 'forbidden',
        message: `quote is routed to approver ${quote.approverId}`,
      };
    }
    if (actor.id === quote.specialistId) {
      // Four-eyes: the specialist who signed off cannot also be the approver.
      return {
        ok: false,
        error: 'forbidden',
        message: 'the specialist who signed off cannot also approve this quote',
      };
    }
    return {
      ok: true,
      to: action === 'approve' ? 'approved' : 'rejected',
      step: 'approver',
    };
  }
  return {
    ok: false,
    error: 'conflict',
    message: `quote is ${quote.status}; no decision possible`,
  };
}

export function toRoutingResult(q: QuoteRecord): RoutingResult {
  if (q.status === 'duplicate' || !q.evaluation) {
    // D5 (human decision): duplicates are not priced or routed — all values null.
    return {
      draft_id: q.id,
      status: 'duplicate',
      net_total: null,
      effective_discount_pct: null,
      approver_id: null,
      specialist_review_flags: [],
      duplicate_of: q.duplicateOf,
    };
  }
  const e = q.evaluation;
  return {
    draft_id: q.id,
    status:
      e.tier === 'specialist_only' ? 'specialist_only' : 'approver_required',
    net_total: centsToUsd(e.netCents),
    effective_discount_pct: round2(e.effectiveDiscountPct),
    approver_id: e.approverId,
    specialist_review_flags: e.flags,
    duplicate_of: null,
  };
}
