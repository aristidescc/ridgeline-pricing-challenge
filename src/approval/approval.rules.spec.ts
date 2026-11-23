import { loadApprovalRules } from '../config/approval-rules.js';
import type { Approver } from '../reporting/reporting.repository.js';
import { lowConfidenceFlags, routeQuote } from './approval.rules.js';

const rules = loadApprovalRules('config/approval-rules.json');
const today = '2026-10-12';

const person = (
  approverId: string,
  role: string,
  region: string,
  backupApproverId: string | null,
  ooo: [string, string] | null = null,
): Approver => ({
  approverId,
  name: approverId,
  role,
  region,
  backupApproverId,
  outOfOfficeFrom: ooo?.[0] ?? null,
  outOfOfficeTo: ooo?.[1] ?? null,
});

// Mirrors data-pack/reporting_db/approvers.csv: U02 (Central) is out 10-12..10-16.
const directory: Approver[] = [
  person('U01', 'regional_manager', 'West', 'U04'),
  person('U02', 'regional_manager', 'Central', 'U04', [
    '2026-10-12',
    '2026-10-16',
  ]),
  person('U04', 'sales_operations_director', 'ALL', 'U05'),
  person('U05', 'vp_sales', 'ALL', null),
];

const usd = (n: number) => Math.round(n * 100);

describe('routeQuote — approval tiers', () => {
  it.each([
    ['8% / $435 → specialist only', 8, 435.23, 'West', 'specialist_only', null],
    [
      'exactly 15.00% → specialist only (policy: "15% or less")',
      15,
      1000,
      'West',
      'specialist_only',
      null,
    ],
    [
      '15.38% → regional manager West',
      15.38,
      456.54,
      'West',
      'regional_manager',
      'U01',
    ],
    [
      '5% but $25,000.00 → regional manager (net total rule)',
      5,
      25000,
      'West',
      'regional_manager',
      'U01',
    ],
    [
      '5% and $24,999.99 → specialist only',
      5,
      24999.99,
      'West',
      'specialist_only',
      null,
    ],
    [
      'exactly 25.00% → regional manager (policy: "up to 25%")',
      25,
      1000,
      'West',
      'regional_manager',
      'U01',
    ],
    [
      '15.004% → regional manager (policy: "over 15%", compared unrounded)',
      15.004,
      8499.6,
      'West',
      'regional_manager',
      'U01',
    ],
    ['26.22% → VP of Sales', 26.22, 728.8, 'Central', 'vp', 'U05'],
    ['30% and $50k → VP wins over the $ rule', 30, 50000, 'East', 'vp', 'U05'],
  ])('%s', (_name, pct, net, region, tier, approverId) => {
    const r = routeQuote(
      { effectiveDiscountPct: pct, netCents: usd(net), region },
      rules,
      directory,
      today,
    );
    expect(r.tier).toBe(tier);
    expect(r.approverId).toBe(approverId);
  });

  it('float noise below 2 decimals does not push 15% into the manager tier', () => {
    const r = routeQuote(
      { effectiveDiscountPct: 15.000000001, netCents: 100, region: 'West' },
      rules,
      directory,
      today,
    );
    expect(r.tier).toBe('specialist_only');
  });
});

describe('routeQuote — backup approver', () => {
  it('routes to the backup when the regional manager is out of office today', () => {
    const r = routeQuote(
      {
        effectiveDiscountPct: 18.36,
        netCents: usd(1409.86),
        region: 'Central',
      },
      rules,
      directory,
      today,
    );
    expect(r).toMatchObject({ approverId: 'U04', primaryApproverId: 'U02' });
    expect(r.flags).toEqual([]);
  });

  it('uses the primary approver again once the out-of-office range has ended', () => {
    const r = routeQuote(
      { effectiveDiscountPct: 18, netCents: 100, region: 'Central' },
      rules,
      directory,
      '2026-10-17',
    );
    expect(r.approverId).toBe('U02');
  });

  it('follows the backup chain when the backup is also out', () => {
    const outU04 = directory.map((a) =>
      a.approverId === 'U04'
        ? { ...a, outOfOfficeFrom: today, outOfOfficeTo: today }
        : a,
    );
    const r = routeQuote(
      { effectiveDiscountPct: 18, netCents: 100, region: 'Central' },
      rules,
      outU04,
      today,
    );
    expect(r.approverId).toBe('U05');
  });
});

describe('lowConfidenceFlags', () => {
  it('flags lines below 0.85 only', () => {
    const line = (n: number, c: number) => ({
      line: n,
      part_number: 'P',
      quantity: 1,
      unit: 'EA',
      extraction_confidence: c,
    });
    expect(
      lowConfidenceFlags([line(1, 0.97), line(2, 0.85), line(3, 0.62)], 0.85),
    ).toEqual([{ line: 3, reason: 'extraction confidence 0.62' }]);
  });
});
