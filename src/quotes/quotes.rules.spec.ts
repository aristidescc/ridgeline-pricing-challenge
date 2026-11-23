import type { Draft } from '../common/domain.types.js';
import { decide, findDuplicate, lineSignature } from './quotes.rules.js';

const draft = (
  id: string,
  rfq: string,
  created: string,
  lines: [string, number][],
): Draft => ({
  draft_id: id,
  rfq_id: rfq,
  customer_id: 'C1008',
  created_at: created,
  proposed_discount_pct: 18,
  lines: lines.map(([part_number, quantity], i) => ({
    line: i + 1,
    part_number,
    quantity,
    unit: 'BX',
    extraction_confidence: 0.97,
  })),
});

const LINES: [string, number][] = [
  ['RL142504', 3],
  ['RL153354', 5],
  ['RL165909', 4],
];
const original = draft(
  'DQ-24102',
  'RFQ-1010',
  '2026-10-12T08:11:00-05:00',
  LINES,
);
const prior = [
  {
    id: original.draft_id,
    rfqId: original.rfq_id,
    lineSignature: lineSignature(original.lines),
    createdAt: original.created_at,
  },
];

describe('findDuplicate', () => {
  it.each([
    [
      'same RFQ + same lines 74 min later → duplicate of the original (DQ-24110)',
      'RFQ-1010',
      '2026-10-12T09:25:00-05:00',
      LINES,
      'DQ-24102',
    ],
    [
      'same lines in a different order → still a duplicate',
      'RFQ-1010',
      '2026-10-12T09:25:00-05:00',
      [...LINES].reverse(),
      'DQ-24102',
    ],
    [
      'same RFQ, different quantity → not a duplicate',
      'RFQ-1010',
      '2026-10-12T09:25:00-05:00',
      [
        ['RL142504', 4],
        ['RL153354', 5],
        ['RL165909', 4],
      ],
      null,
    ],
    [
      'same lines, different RFQ → not a duplicate',
      'RFQ-9999',
      '2026-10-12T09:25:00-05:00',
      LINES,
      null,
    ],
    [
      'same RFQ + lines but 25h later → outside the 24h window',
      'RFQ-1010',
      '2026-10-13T09:11:00-05:00',
      LINES,
      null,
    ],
  ])('%s', (_n, rfq, created, lines, expected) => {
    expect(
      findDuplicate(
        draft('DQ-24110', rfq, created, lines as [string, number][]),
        prior,
        24,
      ),
    ).toBe(expected);
  });
});

describe('decide (who may approve)', () => {
  const pendingSpecialist = (tier: 'specialist_only' | 'regional_manager') => ({
    status: 'pending_specialist' as const,
    approverId: tier === 'specialist_only' ? null : 'U01',
    evaluation: { tier } as never,
    specialistId: null as string | null,
  });
  const S01 = { id: 'S01', role: 'quote_specialist' };
  const U01 = { id: 'U01', role: 'regional_manager' };
  const U03 = { id: 'U03', role: 'regional_manager' };

  it.each([
    [
      'specialist approves a specialist-only quote → approved',
      pendingSpecialist('specialist_only'),
      S01,
      'approve',
      { ok: true, to: 'approved' },
    ],
    [
      'specialist approves a manager-tier quote → pending_approver',
      pendingSpecialist('regional_manager'),
      S01,
      'approve',
      { ok: true, to: 'pending_approver' },
    ],
    [
      'manager cannot skip the specialist step',
      pendingSpecialist('regional_manager'),
      U01,
      'approve',
      { ok: false, error: 'forbidden' },
    ],
    [
      'routed approver approves → approved',
      {
        ...pendingSpecialist('regional_manager'),
        status: 'pending_approver' as const,
      },
      U01,
      'approve',
      { ok: true, to: 'approved' },
    ],
    [
      'a different manager cannot approve',
      {
        ...pendingSpecialist('regional_manager'),
        status: 'pending_approver' as const,
      },
      U03,
      'approve',
      { ok: false, error: 'forbidden' },
    ],
    [
      'specialist who signed off cannot also approve as the routed approver',
      {
        ...pendingSpecialist('regional_manager'),
        status: 'pending_approver' as const,
        specialistId: 'U01',
      },
      U01,
      'approve',
      { ok: false, error: 'forbidden' },
    ],
    [
      'manager tier with no available approver → conflict, never parked',
      { ...pendingSpecialist('regional_manager'), approverId: null },
      S01,
      'approve',
      { ok: false, error: 'conflict' },
    ],
    [
      'already approved → conflict (no double approval)',
      { ...pendingSpecialist('specialist_only'), status: 'approved' as const },
      S01,
      'approve',
      { ok: false, error: 'conflict' },
    ],
  ])('%s', (_n, quote, actor, action, expected) => {
    expect(
      decide(quote, actor, action as 'approve', 'quote_specialist'),
    ).toMatchObject(expected);
  });
});
