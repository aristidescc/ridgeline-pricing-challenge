import { centsToUsd, round2 } from '../pricing/pricing.rules.js';
import type { QuoteRecord } from './quote.types.js';
import { toRoutingResult } from './quotes.rules.js';

/** HTTP representation: workflow status + the spec routing result + pricing detail. */
export function toQuoteView(q: QuoteRecord) {
  const e = q.evaluation;
  return {
    draft_id: q.id,
    rfq_id: q.rfqId,
    customer_id: q.customerId,
    status: q.status,
    version: q.version,
    routing: toRoutingResult(q),
    approval: {
      tier: e?.tier ?? null,
      specialist_id: q.specialistId,
      approver_id: q.approverId,
      primary_approver_id: e?.primaryApproverId ?? null,
    },
    pricing: e
      ? {
          list_total: centsToUsd(e.listCents),
          net_total: centsToUsd(e.netCents),
          effective_discount_pct: round2(e.effectiveDiscountPct),
          proposed_discount_pct: q.draft.proposed_discount_pct,
          stock_status: e.stockStatus,
          lines: e.lines.map((l) => ({
            line: l.line,
            part_number: l.partNumber,
            quantity: l.quantity,
            unit: l.unit,
            unit_list_price: centsToUsd(l.unitListCents),
            unit_price: centsToUsd(l.unitPriceCents),
            price_source: l.priceSource,
            line_net_total: centsToUsd(l.netCents),
          })),
        }
      : null,
    prepared_by: q.draft.prepared_by ?? null,
    received_at: q.receivedAt,
    updated_at: q.updatedAt,
  };
}
