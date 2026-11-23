import type { Draft, ReviewFlag } from '../common/domain.types.js';
import type { Tier } from '../approval/approval.rules.js';
import type { PricedLine } from '../pricing/pricing.rules.js';
import type { StockStatus } from '../stock/stock.rules.js';

/**
 * pending_specialist → approved (specialist_only tier) | pending_approver
 * pending_approver   → approved (routed approver only)
 * pending_*          → rejected
 * duplicate is terminal. There is no path to approved without a person.
 */
export type QuoteStatus =
  | 'pending_specialist'
  | 'pending_approver'
  | 'approved'
  | 'rejected'
  | 'duplicate';

export interface QuoteEvaluation {
  region: string;
  lines: PricedLine[];
  listCents: number;
  netCents: number;
  effectiveDiscountPct: number;
  tier: Tier;
  approverId: string | null;
  primaryApproverId: string | null;
  stockStatus: StockStatus;
  flags: ReviewFlag[];
  evaluatedAt: string;
}

export interface QuoteRecord {
  id: string;
  rfqId: string;
  customerId: string;
  status: QuoteStatus;
  version: number;
  lineSignature: string;
  createdAt: string;
  receivedAt: string;
  updatedAt: string;
  approverId: string | null;
  specialistId: string | null;
  duplicateOf: string | null;
  draft: Draft;
  evaluation: QuoteEvaluation | null;
}

/** Deliverable 1 row (outputs/routing_results.json). Field names match the spec exactly. */
export interface RoutingResult {
  draft_id: string;
  status: 'specialist_only' | 'approver_required' | 'duplicate';
  net_total: number | null;
  effective_discount_pct: number | null;
  approver_id: string | null;
  specialist_review_flags: ReviewFlag[];
  duplicate_of: string | null;
}
