import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { retry, type RetryOptions } from '../common/retry.js';

export interface StockReading {
  partNumber: string;
  warehouses: Record<string, number>;
  asOf: string;
}

export type StockResult =
  | { status: 'ok'; items: Map<string, StockReading>; notFound: string[] }
  | { status: 'unavailable'; reason: string };

/** Port for the Ridgeline stock API (read-only, hourly snapshot). */
export abstract class StockClient {
  abstract getStock(partNumbers: string[]): Promise<StockResult>;
}

interface ApiItem {
  part_number: string;
  warehouses: Record<string, number>;
  as_of: string;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`stock API responded ${status}`);
  }
}

const BATCH_MAX = 50; // stock_api.md: GET /v1/stock?part_numbers=… (max 50)

/**
 * Real HTTP client. 5xx, timeouts and network errors are retried with backoff; when retries
 * are exhausted it returns { status: 'unavailable' } — it never throws into the business flow
 * and never guesses stock.
 */
export class HttpStockClient extends StockClient {
  private readonly logger = new Logger(HttpStockClient.name);

  constructor(
    private readonly baseUrl: string,
    private readonly retryOpts: RetryOptions,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super();
  }

  async getStock(partNumbers: string[]): Promise<StockResult> {
    const unique = [...new Set(partNumbers)];
    const items = new Map<string, StockReading>();
    const notFound: string[] = [];
    try {
      for (let i = 0; i < unique.length; i += BATCH_MAX) {
        const chunk = unique.slice(i, i + BATCH_MAX);
        const body = await retry((signal) => this.fetchBatch(chunk, signal), {
          ...this.retryOpts,
          shouldRetry: (err) =>
            !(err instanceof HttpStatusError) || err.status >= 500,
          onRetry: (attempt, err, delay) =>
            this.logger.warn(
              `stock API attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}); retrying in ${delay}ms`,
            ),
        });
        body.items.forEach((it) =>
          items.set(it.part_number, {
            partNumber: it.part_number,
            warehouses: it.warehouses,
            asOf: it.as_of,
          }),
        );
        notFound.push(...body.not_found);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`stock unavailable: ${reason}`);
      return { status: 'unavailable', reason };
    }
    return { status: 'ok', items, notFound };
  }

  private async fetchBatch(
    partNumbers: string[],
    signal: AbortSignal,
  ): Promise<{ items: ApiItem[]; not_found: string[] }> {
    const url = `${this.baseUrl}/v1/stock?part_numbers=${encodeURIComponent(partNumbers.join(','))}`;
    const res = await this.fetchFn(url, { signal });
    if (!res.ok) throw new HttpStatusError(res.status);
    return (await res.json()) as { items: ApiItem[]; not_found: string[] };
  }
}

/** STUB: reads data-pack/stock_fixture.json — prod: HttpStockClient against Ridgeline IT's stock API. Used for tests/offline runs. */
export class FixtureStockClient extends StockClient {
  private readonly data: Record<string, ApiItem>;

  constructor(pathOrData: string | Record<string, ApiItem>) {
    super();
    this.data =
      typeof pathOrData === 'string'
        ? (JSON.parse(readFileSync(pathOrData, 'utf8')) as Record<
            string,
            ApiItem
          >)
        : pathOrData;
  }

  getStock(partNumbers: string[]): Promise<StockResult> {
    const items = new Map<string, StockReading>();
    const notFound: string[] = [];
    for (const pn of new Set(partNumbers)) {
      const it = this.data[pn];
      if (it) {
        items.set(pn, {
          partNumber: pn,
          warehouses: it.warehouses,
          asOf: it.as_of,
        });
      } else {
        notFound.push(pn);
      }
    }
    return Promise.resolve({ status: 'ok', items, notFound });
  }
}
