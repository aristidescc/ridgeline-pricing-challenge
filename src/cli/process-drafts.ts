import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Draft } from '../common/domain.types.js';

/**
 * Batch entry point: runs every draft through the same QuotesService the HTTP API uses and
 * writes outputs/routing_results.json (Deliverable 1, input order) + outputs/audit_log.json.
 * Usage: node dist/cli/process-drafts.js [drafts.json] — set AS_OF for a deterministic run.
 */
const logger = new Logger('ProcessDrafts');
// Each batch run gets a fresh in-memory store unless APP_DB_PATH is set explicitly.
process.env.APP_DB_PATH ??= ':memory:';

const { AppModule } = await import('../app.module.js');
const { QuotesService } = await import('../quotes/quotes.service.js');
const { AuditService } = await import('../audit/audit.service.js');
const { toRoutingResult } = await import('../quotes/quotes.rules.js');

const input = process.argv[2] ?? 'data-pack/draft_quotes.json';
const outDir = process.env.OUTPUT_DIR ?? 'outputs';
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});
try {
  const quotes = app.get(QuotesService);
  const { drafts } = JSON.parse(readFileSync(input, 'utf8')) as {
    drafts: Draft[];
  };
  const system = { id: 'system', name: 'Batch processor', role: 'system' };
  const results = [];
  for (const draft of drafts) {
    const { quote } = await quotes.intake(draft, system);
    const row = toRoutingResult(quote);
    results.push(row);
    logger.log(
      `${row.draft_id}: ${row.status}${row.approver_id ? ` → ${row.approver_id}` : ''}${row.duplicate_of ? ` (duplicate of ${row.duplicate_of})` : ''} · flags ${row.specialist_review_flags.length}`,
    );
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    `${outDir}/routing_results.json`,
    JSON.stringify(results, null, 2) + '\n',
  );
  writeFileSync(
    `${outDir}/audit_log.json`,
    JSON.stringify(app.get(AuditService).all(), null, 2) + '\n',
  );
  logger.log(
    `wrote ${results.length} results to ${outDir}/routing_results.json`,
  );
} finally {
  await app.close();
}
