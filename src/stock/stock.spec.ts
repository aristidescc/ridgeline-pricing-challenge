import { retry, RetryExhaustedError } from '../common/retry.js';
import { FixtureStockClient, HttpStockClient } from './stock.client.js';
import { stockFlags } from './stock.rules.js';

const noSleep = () => Promise.resolve();
const opts = { attempts: 3, timeoutMs: 100, baseDelayMs: 10, sleep: noSleep };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('retry', () => {
  it('retries with exponential backoff and then succeeds', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await retry(
      () =>
        ++calls < 3 ? Promise.reject(new Error('503')) : Promise.resolve('ok'),
      { ...opts, random: () => 1, sleep: (ms) => (delays.push(ms), noSleep()) },
    );
    expect(result).toBe('ok');
    expect(delays).toEqual([10, 20]);
  });

  it('throws RetryExhaustedError after the last attempt', async () => {
    await expect(
      retry(() => Promise.reject(new Error('down')), opts),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
  });
});

describe('HttpStockClient', () => {
  it('retries 503s and returns stock once the API recovers', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: 'service_unavailable' }))
      .mockResolvedValueOnce(
        json(200, {
          items: [
            {
              part_number: 'P1',
              warehouses: { DAL: 3 },
              as_of: '2026-10-12T08:00:00-05:00',
            },
          ],
          not_found: ['P2'],
        }),
      );
    const client = new HttpStockClient('http://stock', opts, fetchFn);
    const r = await client.getStock(['P1', 'P2']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r.status).toBe('ok');
  });

  it('returns unavailable (does not throw, does not guess) when retries are exhausted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(503, {}));
    const client = new HttpStockClient('http://stock', opts, fetchFn);
    const r = await client.getStock(['P1']);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ status: 'unavailable' });
  });
});

describe('HttpStockClient timeout', () => {
  it('aborts a hung stock API after the per-try timeout and returns unavailable', async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('timeout')),
        ),
      );
    const fetchFn = vi.fn(hang);
    const client = new HttpStockClient(
      'http://stock',
      { ...opts, timeoutMs: 5 },
      fetchFn as unknown as typeof fetch,
    );
    const r = await client.getStock(['P1']);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ status: 'unavailable' });
  });
});

describe('stockFlags', () => {
  const asOf = new Date('2026-10-12T09:30:00-05:00');
  const line = (n: number, pn: string) => ({
    line: n,
    part_number: pn,
    quantity: 1,
    unit: 'EA',
    extraction_confidence: 0.97,
  });
  const fixture = new FixtureStockClient({
    OK: {
      part_number: 'OK',
      warehouses: { DAL: 5, PHX: 0 },
      as_of: '2026-10-12T08:00:00-05:00',
    },
    ZERO: {
      part_number: 'ZERO',
      warehouses: { DAL: 0, PHX: 0 },
      as_of: '2026-10-12T08:00:00-05:00',
    },
    OLD: {
      part_number: 'OLD',
      warehouses: { DAL: 9 },
      as_of: '2026-10-10T08:00:00-05:00',
    },
  });

  it.each([
    ['in stock and fresh → no flag', 'OK', null],
    [
      'zero in all warehouses → out of stock',
      'ZERO',
      'out of stock in all warehouses',
    ],
    ['not in the stock API → not found', 'MISSING', 'not found in stock API'],
    ['reading 49.5h old → stale', 'OLD', 'stale'],
  ])('%s', async (_n, pn, reason) => {
    const r = stockFlags([line(1, pn)], await fixture.getStock([pn]), asOf, 24);
    if (reason === null) expect(r.flags).toEqual([]);
    else expect(r.flags[0].reason).toContain(reason);
  });

  it('unavailable stock becomes one whole-quote flag', () => {
    const r = stockFlags(
      [line(1, 'OK')],
      { status: 'unavailable', reason: 'x' },
      asOf,
      24,
    );
    expect(r).toEqual({
      status: 'unavailable',
      flags: [{ line: null, reason: 'stock unavailable after retries' }],
    });
  });
});
