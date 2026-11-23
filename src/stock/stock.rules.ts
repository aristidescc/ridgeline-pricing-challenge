import { hoursBetween } from '../common/clock.js';
import type { DraftLine, ReviewFlag } from '../common/domain.types.js';
import type { StockResult } from './stock.client.js';

export type StockStatus = 'ok' | 'flagged' | 'unavailable';

/**
 * Turns a stock lookup into specialist review flags. Flags never block routing (D1).
 *  - Policy §9: "Any part that is out of stock in all warehouses, or not found in the stock API"
 *  - Policy §10: "Any stock reading older than 24 hours"
 *  - Spec Part 3: retries exhausted → "marked with stock unavailable rather than blocked or guessed"
 */
export function stockFlags(
  lines: DraftLine[],
  result: StockResult,
  asOf: Date,
  maxAgeHours: number,
): { status: StockStatus; flags: ReviewFlag[] } {
  if (result.status === 'unavailable') {
    return {
      status: 'unavailable',
      flags: [{ line: null, reason: 'stock unavailable after retries' }],
    };
  }
  const flags: ReviewFlag[] = [];
  for (const l of lines) {
    const reading = result.items.get(l.part_number);
    if (!reading) {
      flags.push({
        line: l.line,
        reason: `part ${l.part_number} not found in stock API`,
      });
      continue;
    }
    const total = Object.values(reading.warehouses).reduce((s, n) => s + n, 0);
    if (total <= 0) {
      flags.push({ line: l.line, reason: 'out of stock in all warehouses' });
    }
    const age = hoursBetween(new Date(reading.asOf), asOf);
    if (age > maxAgeHours) {
      flags.push({
        line: l.line,
        reason: `stock reading stale: as of ${reading.asOf} (${age.toFixed(1)}h old, limit ${maxAgeHours}h)`,
      });
    }
  }
  return { status: flags.length ? 'flagged' : 'ok', flags };
}
