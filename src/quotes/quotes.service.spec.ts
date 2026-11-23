import { ConflictException, ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { AuditService } from '../audit/audit.service.js';
import { FixedClock } from '../common/clock.js';
import type { Draft } from '../common/domain.types.js';
import { loadApprovalRules } from '../config/approval-rules.js';
import { DatabaseService } from '../database/database.service.js';
import { ReportingRepository } from '../reporting/reporting.repository.js';
import { FixtureStockClient, StockClient } from '../stock/stock.client.js';
import { QuotesRepository } from './quotes.repository.js';
import { toRoutingResult } from './quotes.rules.js';
import { QuotesService } from './quotes.service.js';

const drafts = (
  JSON.parse(readFileSync('data-pack/draft_quotes.json', 'utf8')) as {
    drafts: Draft[];
  }
).drafts;
const intakeUser = { id: 'intake', name: 'Intake', role: 'intake_service' };
const S01 = { id: 'S01', name: 'Maria', role: 'quote_specialist' };
const U01 = { id: 'U01', name: 'Priya', role: 'regional_manager' };
const U03 = { id: 'U03', name: 'Alicia', role: 'regional_manager' };

function setup(
  stock: StockClient = new FixtureStockClient('data-pack/stock_fixture.json'),
) {
  const database = new DatabaseService(':memory:');
  const audit = new AuditService(database);
  const service = new QuotesService(
    new QuotesRepository(database),
    audit,
    database,
    stock,
    ReportingRepository.fromDir('data-pack/reporting_db'),
    loadApprovalRules('config/approval-rules.json'),
    new FixedClock(new Date('2026-10-12T09:30:00-05:00')),
  );
  return { service, audit, database };
}

describe('QuotesService', () => {
  it('routes the 10 sample drafts: specialist-only, manager, VP, backup and duplicate', async () => {
    const { service } = setup();
    const rows = [];
    for (const d of drafts) {
      rows.push(toRoutingResult((await service.intake(d, intakeUser)).quote));
    }
    expect(
      rows.map((r) => [r.draft_id, r.status, r.approver_id, r.duplicate_of]),
    ).toEqual([
      ['DQ-24101', 'specialist_only', null, null],
      ['DQ-24102', 'approver_required', 'U01', null],
      ['DQ-24103', 'approver_required', 'U05', null],
      ['DQ-24104', 'approver_required', 'U05', null],
      ['DQ-24105', 'specialist_only', null, null],
      ['DQ-24106', 'approver_required', 'U04', null], // U02 out of office → backup
      ['DQ-24107', 'approver_required', 'U01', null],
      ['DQ-24108', 'specialist_only', null, null],
      ['DQ-24109', 'approver_required', 'U04', null],
      ['DQ-24110', 'duplicate', null, 'DQ-24102'],
    ]);
    expect(rows[4].specialist_review_flags).toEqual([
      { line: 3, reason: 'extraction confidence 0.62' },
    ]);
  });

  it('runs specialist → routed approver → approved, with an audit row per step', async () => {
    const { service } = setup();
    await service.intake(drafts[1], intakeUser); // DQ-24102 → U01

    expect(() => service.approve('DQ-24102', U01)).toThrow(ForbiddenException); // specialist first
    expect(service.approve('DQ-24102', S01).status).toBe('pending_approver');
    expect(() => service.approve('DQ-24102', U03)).toThrow(ForbiddenException); // not the routed approver
    expect(service.approve('DQ-24102', U01, 'ok').status).toBe('approved');
    expect(() => service.approve('DQ-24102', U01)).toThrow(ConflictException); // no double approval

    expect(
      service
        .history('DQ-24102')
        .map((a) => [a.actor, a.action, a.from_status, a.to_status]),
    ).toEqual([
      ['intake', 'quote_created', null, 'pending_specialist'],
      ['S01', 'specialist_approved', 'pending_specialist', 'pending_approver'],
      ['U01', 'approver_approved', 'pending_approver', 'approved'],
    ]);
  });

  it('marks stock unavailable (not blocked, not guessed) when the stock API is down', async () => {
    const down: StockClient = {
      getStock: () =>
        Promise.resolve({ status: 'unavailable', reason: '503 x4' }),
    };
    const { service } = setup(down);
    const { quote } = await service.intake(drafts[0], intakeUser);
    expect(quote.status).toBe('pending_specialist');
    expect(toRoutingResult(quote).specialist_review_flags).toContainEqual({
      line: null,
      reason: 'stock unavailable after retries',
    });
  });

  it('a replayed draft_id returns the stored quote without a second approval request', async () => {
    const { service, audit } = setup();
    expect((await service.intake(drafts[0], intakeUser)).created).toBe(true);
    expect((await service.intake(drafts[0], intakeUser)).created).toBe(false);
    expect(audit.forEntity('DQ-24101')).toHaveLength(1);
  });

  it('the audit log rejects updates and deletes', async () => {
    const { service, database } = setup();
    await service.intake(drafts[0], intakeUser);
    expect(() =>
      database.db.prepare("UPDATE audit_log SET actor = 'x'").run(),
    ).toThrow(/append-only/);
    expect(() => database.db.prepare('DELETE FROM audit_log').run()).toThrow(
      /append-only/,
    );
  });
});
