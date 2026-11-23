import type { Draft, ReviewFlag } from '../common/domain.types.js';
import { hoursBetween } from '../common/clock.js';
import type { PricingReference } from '../reporting/reporting.repository.js';

export type PriceSource = 'contract' | 'list' | 'unknown_part';

export interface PricedLine {
  line: number;
  partNumber: string;
  quantity: number;
  unit: string;
  unitListCents: number;
  unitPriceCents: number;
  priceSource: PriceSource;
  listCents: number;
  netCents: number;
}

export interface PricingResult {
  lines: PricedLine[];
  listCents: number;
  netCents: number;
  /** Unrounded; round only at the output edge. */
  effectiveDiscountPct: number;
  flags: ReviewFlag[];
}

/**
 * Prices a draft from the reporting snapshot. Pure: no I/O.
 * @param today business-calendar date (YYYY-MM-DD) used for contract validity.
 */
export function priceQuote(
  draft: Draft,
  ref: PricingReference,
  today: string,
): PricingResult {
  const flags: ReviewFlag[] = [];
  const lines: PricedLine[] = [];

  for (const l of draft.lines) {
    const product = ref.product(l.part_number);
    if (!product) {
      // Never guess a price: unknown part is excluded from totals and sent to the specialist.
      flags.push({
        line: l.line,
        reason: `part ${l.part_number} not found in reporting database`,
      });
      lines.push({
        line: l.line,
        partNumber: l.part_number,
        quantity: l.quantity,
        unit: l.unit,
        unitListCents: 0,
        unitPriceCents: 0,
        priceSource: 'unknown_part',
        listCents: 0,
        netCents: 0,
      });
      continue;
    }
    if (product.status !== 'active') {
      flags.push({
        line: l.line,
        reason: `part status ${product.status}${product.replacedBy ? ` (replaced by ${product.replacedBy})` : ''}`,
      });
    }
    if (product.unit !== l.unit) {
      flags.push({
        line: l.line,
        reason: `unit mismatch: draft ${l.unit}, catalog ${product.unit}`,
      });
    }

    // Policy §3: "Use the customer's contract price when one exists and is valid today
    // (valid_from <= today <= valid_to). Otherwise use the list price."
    const contracts = ref.contracts(draft.customer_id, l.part_number);
    const valid = contracts.find(
      (c) => c.validFrom <= today && today <= c.validTo,
    );
    let unitPriceCents = product.listPriceCents;
    let priceSource: PriceSource = 'list';
    if (valid) {
      unitPriceCents = valid.contractPriceCents;
      priceSource = 'contract';
    } else if (contracts.length > 0) {
      // Policy §4: "If a contract price exists but has expired, use the list price and flag the line."
      const latest = contracts.reduce((a, b) =>
        a.validTo > b.validTo ? a : b,
      );
      flags.push({
        line: l.line,
        reason:
          latest.validTo < today
            ? `contract price expired ${latest.validTo}; list price used`
            : `contract price not valid until ${latest.validFrom}; list price used`,
      });
    }

    // Policy §5: "proposed_discount_pct is applied on top of the line price (contract or list)."
    const listCents = l.quantity * product.listPriceCents;
    const netCents = Math.round(
      (l.quantity * unitPriceCents * (100 - draft.proposed_discount_pct)) / 100,
    );
    lines.push({
      line: l.line,
      partNumber: l.part_number,
      quantity: l.quantity,
      unit: l.unit,
      unitListCents: product.listPriceCents,
      unitPriceCents,
      priceSource,
      listCents,
      netCents,
    });
  }

  const listCents = lines.reduce((s, l) => s + l.listCents, 0);
  const netCents = lines.reduce((s, l) => s + l.netCents, 0);
  // Policy §6: "Effective discount = 1 - (quote net total / quote total at list price)."
  const effectiveDiscountPct =
    listCents > 0 ? (1 - netCents / listCents) * 100 : 0;
  return { lines, listCents, netCents, effectiveDiscountPct, flags };
}

/** Policy §10: "a reporting database export older than 36 hours (data must be confirmed)". */
export function reportingFreshnessFlags(
  exportedAt: Date,
  asOf: Date,
  maxAgeHours: number,
): ReviewFlag[] {
  const age = hoursBetween(exportedAt, asOf);
  return age > maxAgeHours
    ? [
        {
          line: null,
          reason: `reporting data stale: exported ${exportedAt.toISOString()} (${age.toFixed(1)}h old, limit ${maxAgeHours}h)`,
        },
      ]
    : [];
}

/** Money/percent formatting happens only at the output edge. */
export const centsToUsd = (cents: number): number => Math.round(cents) / 100;
export const round2 = (n: number): number => Math.round(n * 100) / 100;
