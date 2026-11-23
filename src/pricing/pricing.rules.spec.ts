import type { Draft } from '../common/domain.types.js';
import type {
  ContractPrice,
  PricingReference,
  Product,
} from '../reporting/reporting.repository.js';
import {
  priceQuote,
  reportingFreshnessFlags,
  round2,
} from './pricing.rules.js';

const product = (partNumber: string, listPriceCents: number): Product => ({
  partNumber,
  description: partNumber,
  unit: 'EA',
  listPriceCents,
  status: 'active',
  replacedBy: null,
});

function ref(
  products: Product[],
  contracts: ContractPrice[],
): PricingReference {
  return {
    product: (pn) => products.find((p) => p.partNumber === pn),
    contracts: (c, pn) =>
      contracts.filter((x) => x.customerId === c && x.partNumber === pn),
  };
}

const draft = (pct: number, lines: [string, number][]): Draft => ({
  draft_id: 'DQ-1',
  rfq_id: 'RFQ-1',
  customer_id: 'C1',
  created_at: '2026-10-12T08:00:00-05:00',
  proposed_discount_pct: pct,
  lines: lines.map(([part_number, quantity], i) => ({
    line: i + 1,
    part_number,
    quantity,
    unit: 'EA',
    extraction_confidence: 0.97,
  })),
});

const contract = (from: string, to: string, cents: number): ContractPrice => ({
  customerId: 'C1',
  partNumber: 'P1',
  contractPriceCents: cents,
  validFrom: from,
  validTo: to,
});

describe('priceQuote', () => {
  const today = '2026-10-12';

  it.each([
    [
      'valid contract price is used',
      [contract('2026-01-01', '2026-12-31', 800)],
      'contract',
      800,
      0,
    ],
    ['no contract falls back to list price', [], 'list', 1000, 0],
    [
      'expired contract uses list price and flags the line',
      [contract('2025-01-01', '2025-12-31', 800)],
      'list',
      1000,
      1,
    ],
    [
      'contract valid on its last day is used',
      [contract('2026-01-01', '2026-10-12', 800)],
      'contract',
      800,
      0,
    ],
  ])('%s', (_name, contracts, source, unitPrice, flagCount) => {
    const r = priceQuote(
      draft(0, [['P1', 2]]),
      ref([product('P1', 1000)], contracts as ContractPrice[]),
      today,
    );
    expect(r.lines[0].priceSource).toBe(source);
    expect(r.lines[0].unitPriceCents).toBe(unitPrice);
    expect(r.flags).toHaveLength(flagCount as number);
  });

  it('effective discount is measured against list, so contract prices raise it above the proposed %', () => {
    // list 10.00, contract 8.00, proposed 10% → net 7.20 vs list 10.00 → 28%
    const r = priceQuote(
      draft(10, [['P1', 1]]),
      ref([product('P1', 1000)], [contract('2026-01-01', '2026-12-31', 800)]),
      today,
    );
    expect(r.netCents).toBe(720);
    expect(round2(r.effectiveDiscountPct)).toBe(28);
  });

  it('unknown part is flagged and excluded from totals instead of guessed', () => {
    const r = priceQuote(
      draft(0, [
        ['P1', 1],
        ['NOPE', 5],
      ]),
      ref([product('P1', 1000)], []),
      today,
    );
    expect(r.listCents).toBe(1000);
    expect(r.flags).toEqual([
      { line: 2, reason: expect.stringContaining('not found') },
    ]);
  });
});

describe('reportingFreshnessFlags', () => {
  it.each([
    ['31.5h old export is fresh (limit 36h)', '2026-10-11T02:00:00-05:00', 0],
    ['37h old export is flagged', '2026-10-10T20:30:00-05:00', 1],
  ])('%s', (_n, exportedAt, count) => {
    const flags = reportingFreshnessFlags(
      new Date(exportedAt),
      new Date('2026-10-12T09:30:00-05:00'),
      36,
    );
    expect(flags).toHaveLength(count);
  });
});
