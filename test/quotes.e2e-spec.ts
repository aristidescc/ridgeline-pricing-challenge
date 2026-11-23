import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import type { App } from 'supertest/types.js';

process.env.APP_DB_PATH = ':memory:';
process.env.STOCK_CLIENT = 'fixture';
process.env.AS_OF = '2026-10-12T09:30:00-05:00';

const { AppModule } = await import('../src/app.module.js');
const { createValidationPipe } = await import('../src/common/validation.js');

const drafts = (
  JSON.parse(readFileSync('data-pack/draft_quotes.json', 'utf8')) as {
    drafts: { draft_id: string }[];
  }
).drafts;

describe('Quotes API (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects missing/unknown users (401) and non-intake callers on intake (403)', async () => {
    await http().get('/quotes').expect(401);
    await http().get('/quotes').set('x-user-id', 'nobody').expect(401);
    await http()
      .post('/quotes')
      .set('x-user-id', 'S01')
      .send(drafts[1])
      .expect(403);
  });

  it('validates the draft body (400)', async () => {
    await http()
      .post('/quotes')
      .set('x-user-id', 'intake')
      .send({ draft_id: 'X', lines: [] })
      .expect(400);
  });

  it('intake → specialist → routed manager → approved; replay is idempotent', async () => {
    const created = await http()
      .post('/quotes')
      .set('x-user-id', 'intake')
      .send(drafts[1])
      .expect(201);
    expect(created.body.routing).toMatchObject({
      status: 'approver_required',
      approver_id: 'U01',
      net_total: 132.46,
      effective_discount_pct: 18,
    });
    await http()
      .post('/quotes')
      .set('x-user-id', 'intake')
      .send(drafts[1])
      .expect(200);

    await http()
      .post('/quotes/DQ-24102/approve')
      .set('x-user-id', 'U01')
      .send({})
      .expect(403);
    await http()
      .post('/quotes/DQ-24102/approve')
      .set('x-user-id', 'S01')
      .send({})
      .expect(200);
    const done = await http()
      .post('/quotes/DQ-24102/approve')
      .set('x-user-id', 'U01')
      .send({ comment: 'ok' })
      .expect(200);
    expect(done.body.status).toBe('approved');
    await http()
      .post('/quotes/DQ-24102/reject')
      .set('x-user-id', 'U01')
      .send({ reason: 'x' })
      .expect(409);

    const audit = await http()
      .get('/quotes/DQ-24102/audit')
      .set('x-user-id', 'S01')
      .expect(200);
    expect(audit.body).toHaveLength(3);
  });

  it('edit is an explicit stub (501)', async () => {
    await http()
      .patch('/quotes/DQ-24102')
      .set('x-user-id', 'S01')
      .send({})
      .expect(501);
  });
});
