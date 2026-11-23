import { priceQuote, round2 } from '../pricing/pricing.rules.js';
import type { Draft } from '../common/domain.types.js';
import { readFileSync } from 'node:fs';
import { ReportingRepository } from './reporting.repository.js';

describe('ReportingRepository (data pack snapshot)', () => {
  const repo = ReportingRepository.fromDir('data-pack/reporting_db');
  const drafts = (
    JSON.parse(readFileSync('data-pack/draft_quotes.json', 'utf8')) as {
      drafts: Draft[];
    }
  ).drafts;
  const byId = (id: string) => drafts.find((d) => d.draft_id === id)!;

  it('loads approvers with out-of-office dates and the export timestamp', () => {
    expect(repo.approvers.find((a) => a.approverId === 'U02')).toMatchObject({
      outOfOfficeFrom: '2026-10-12',
      backupApproverId: 'U04',
    });
    expect(repo.exportedAt.toISOString()).toBe('2026-10-11T07:00:00.000Z');
  });

  it.each([
    ['DQ-24103', 728.8, 26.22],
    ['DQ-24106', 47652, 5],
    ['DQ-24107', 456.54, 15.38],
  ])('prices %s from contract/list data', (id, net, pct) => {
    const r = priceQuote(byId(id), repo, '2026-10-12');
    expect(r.netCents / 100).toBe(net);
    expect(round2(r.effectiveDiscountPct)).toBe(pct);
  });
});
