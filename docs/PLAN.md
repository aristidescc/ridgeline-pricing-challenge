# Plan — Ridgeline Quote Approvals (pricing + routing service)
Started: 2026-11-23T02:31:45Z · Budget: 60 min · Status: APPROVED (02:36Z)

## 1. Problem
- Ridgeline quote specialists and regional managers: ~30% of quotes wait 4–6 h for discount approval.
- The Intake (extraction) team produces draft quotes. Nobody prices them, checks stock, or routes them automatically.
- We build a NestJS service that prices each draft from the reporting DB, checks stock through the API, routes it to the right person right away (backup applied), and audits every action. A human still approves every quote.

## 2. Scope
**Build:**
- `POST /quotes`: Intake hands over one draft and gets back pricing + routing synchronously.
- `GET /quotes` (list, filter by status / assignee), `GET /quotes/:id`, `POST /quotes/:id/approve`, `POST /quotes/:id/reject`
- Pure pricing rules (contract → list fallback, expired-contract flag, effective discount)
- Pure routing rules from `config/approval-rules.json` (tiers, region → manager, VP, backup / out-of-office)
- HTTP `StockClient` with retry (timeout, exponential backoff + jitter) → `unavailable` after the last attempt
- Staleness flags (stock > 24 h, reporting export > 36 h); duplicate detection (`duplicate_of`)
- Append-only audit log (SQLite), stub auth via the `x-user-id` header + role checks in the service
- `pnpm run process` → `outputs/routing_results.json` (10 rows, input order)

**Stub (what · why · production version):**
| Stub | Why | Production |
|---|---|---|
| Auth = `x-user-id` header resolved against `approvers.csv` | No IdP in scope | OIDC/SAML SSO (Entra ID), JWT validated at a gateway, roles from IdP groups |
| Intake caller = service user `intake` in the header | Same as above | mTLS or client-credentials token for the extraction service |
| Quote edit = `PATCH /quotes/:id` returns 501 with the reprice/reroute explanation | Spec allows it | Edit → re-run pricing + routing → audit before/after values → reset approvals |
| Reporting DB = CSVs loaded read-only into memory at boot | Snapshot is CSV | Read-only replica of the nightly SAP reporting DB |
| Store = local SQLite file | Spec allows it | Postgres (managed), outbox for "approved" events |
| Sending to the customer / SAP | Out of scope; SAP is read-only | Emit an `quote.approved` event; a downstream service sends it |

**Out of scope:** UI, notifications (email/Teams), SAP writes, real rule-editing UI, multi-instance locking.

## 3. Decisions
- **D1 (matters most): degrade by flagging, never by blocking or guessing; the human gate lives in the state machine.** Stock failures and stale data become `specialist_review_flags`, and the quote keeps moving to the right approver immediately. No path reaches `approved` without a specialist sign-off. Trade-off: specialists see more flags, but quotes never stall for hours and never go out on guessed data.
- D2: Effective discount = `1 − net_total / list_total` (policy §6). Tiers: `≤15% AND net < $25,000` → specialist only; `>15% to ≤25% OR net ≥ $25,000` → regional manager of the customer's region; `>25%` → VP (the VP tier wins over the $ rule). Tier comparisons use the effective % rounded to 2 decimals (the value humans see), so float noise cannot flip a tier.
- D3: Processing as-of = `2026-10-12T09:30:00-05:00` (policy header), injected via `Clock`/`AS_OF`. Out-of-office uses the date in Central time, inclusive range.
- D4: Backup chain: if the backup is also out, follow their backup (max depth 3). If the chain is exhausted, route to the VP and flag it. The policy doesn't cover this case.
- D5: Duplicate = same `rfq_id` + same normalized line set (part_number, qty, unit; order-insensitive) as an earlier draft whose `created_at` is within 24 h (policy §11). The first one is the original. Per the human's answer: duplicate rows are **all nulls** (net_total, discount, approver) with `flags: []` and `duplicate_of` set. No approval request is created.
- D6: Low-confidence (< 0.85), out of stock in all warehouses, not found in the stock API, stale stock, expired contract → line-level flags. Stock unavailable after retries and a stale reporting export → `line: null`. Flags never change the tier. They mean "specialist must check before routing" (§8–10).
- D7: Any `quote_specialist` can give the specialist sign-off (human's answer); `prepared_by` is the default assignee. The approver step allows only the routed `approver_id` (backup already applied).
- D8: Stock is fetched through HTTP against `mock_stock_api.py` (human's answer) using the batch endpoint `GET /v1/stock?part_numbers=` (≤50) per quote. 404 / `not_found` = "not found" flag (not a failure). 503 / timeout = retry. The fixture client is used in tests.
- D9: Money in integer cents; line net = round(qty × unit price × (1 − disc)) in cents; percentages rounded to 2 decimals only at output.
- D10: Tooling follows the existing scaffold (pnpm, Vitest, oxlint, ESM) rather than the npm/Jest in CLAUDE.md. AGENTS.md governs the scaffold.
- D12: Stock API `retry_after_seconds` is not honored; exponential backoff with jitter (200 ms base, 4 attempts, 1 s per-try timeout, all env-configurable) keeps the batch fast. Prod: honor Retry-After and add a circuit breaker.
- D13: Intake is idempotent on `draft_id` (a replay returns the stored quote with 200); duplicates by content use D5.
- D11: Reporting data and approvers are loaded from CSV with no extra parser dependency (a small quoted-CSV reader). Thresholds live in config; the people directory comes from `approvers.csv` (the system of record).

## 4. Data findings
- Reporting export `2026-10-11T02:00-05:00` → 31.5 h old at as-of → **not stale** (limit 36 h) → D6
- RL107944 stock `as_of 2026-10-10 08:00` (49.5 h) → stale flag on DQ-24104 L1, DQ-24109 L6 → D6
- RL120374 not in the stock API → DQ-24103 L3 flag; RL110322 has 0 in all warehouses → DQ-24108 L1 flag → D6
- Low confidence: DQ-24105 L3 (0.62), DQ-24109 L3 (0.79). DQ-24103 L4 0.88 and DQ-24105 L2 0.91 are above the limit → D6
- DQ-24107 L1 contract expired 2025-12-31 → list price + flag; effective discount is 15.38% (> 15) → regional manager West U01 → D2
- DQ-24103: proposed 22% but effective 26.22% (contract prices) → VP U05 (shows why the policy uses effective, not proposed) → D2
- DQ-24106: 5% but net $47,652 ≥ $25k → RM Central U02, who is **out 10-12..10-16** → backup U04 → D3/D4
- DQ-24109: 18.36% Central → U02 out → U04
- DQ-24110 = DQ-24102 (RFQ-1010, same lines, +74 min, "resubmitted after a timeout") → duplicate → D5
- Expected statuses: specialist_only = 24101, 24105, 24108 · approver_required = 24102 (U01), 24103 (U05), 24104 (U05), 24106 (U04), 24107 (U01), 24109 (U04) · duplicate = 24110
- No unknown SKUs or customers, no UoM mismatches, no multi-row contracts in the sample. We still guard against them (an unknown SKU → line flag, excluded from totals).

## 5. Domain
Entities:
- `Quote`: id (draft_id), rfq_id, customer_id, region, lines[], net_cents, list_cents, effective_pct, tier, approver_id, flags[], duplicate_of, status, version, created_at
- `AuditEntry`: id, actor, action, entity_id, from_status, to_status, at, details(json)

Statuses + transitions:
- (intake) → `pending_specialist`, actor intake/system
- (intake) → `duplicate` (terminal), actor system
- `pending_specialist` → `approved` when tier=specialist_only (any specialist), or → `pending_approver` (any specialist)
- `pending_approver` → `approved` (only the routed approver_id)
- `pending_specialist | pending_approver` → `rejected` (specialist or routed approver)
- Guarded `UPDATE … WHERE id=? AND status=? AND version=?`; 0 rows → 409.

Rules (pure functions):
- `priceQuote(draft, ref, asOf) → { lines, netCents, listCents, effectivePct, flags }`
- `stockFlags(lines, stockResult, asOf, maxAgeH) → flags`
- `routeQuote({ effectivePct, netCents, region }, rules, directory, asOf) → { tier, approverId, flags }`
- `findDuplicate(draft, prior[], windowH) → draft_id | null`
- `toRoutingResult(quote) → spec row`

## 6. Module map
| Module | Responsibility | Key files |
|---|---|---|
| `config` | typed config + validated rules JSON | `src/config/configuration.ts`, `approval-rules.schema.ts` |
| `common` | Clock, retry, AuthGuard, @CurrentUser | `clock.ts`, `retry.ts`, `auth.guard.ts`, `current-user.decorator.ts` |
| `reporting` | read-only CSV snapshot: products, customers, contracts, approvers, exported_at | `reporting.repository.ts` |
| `pricing` | pure pricing rules | `pricing.rules.ts` (+spec) |
| `stock` | `StockClient` port: `HttpStockClient` (retry), `FixtureStockClient` | `stock.client.ts`, `stock.rules.ts` |
| `approval` | pure routing | `approval.rules.ts` (+spec) |
| `audit` | append-only log | `audit.service.ts` |
| `database` | better-sqlite3 connection, `CREATE TABLE IF NOT EXISTS` | `database.module.ts` |
| `quotes` | intake, duplicate check, state machine, API | `quotes.controller.ts`, `quotes.service.ts`, `quotes.repository.ts`, `quotes.rules.ts`, `dto/` |
| `cli` | batch → outputs file | `src/cli/process-drafts.ts` |

Config files: `config/approval-rules.json` (tier thresholds in pct/cents, low-confidence threshold, staleness hours, duplicate window, region → role mapping, backup max depth, as-of timezone).
Entry points: HTTP `pnpm run start:dev` · batch `pnpm run process` (mock on :8080) · tests `pnpm test`

## 7. Tasks
- [x] T1 (6) Config + reporting repo + pure pricing — files: `config/approval-rules.json`, `src/config/*`, `src/common/clock.ts`, `src/reporting/*`, `src/pricing/pricing.rules.ts` — tests: contract vs list vs expired, effective % (DQ-24103 = 26.22) — done when: green — done T+09, 12 tests
- [x] T2 (7) Pure routing rules — `src/approval/approval.rules.ts` — tests (it.each): specialist tier, RM tier by %, RM tier by $25k, VP tier, boundary exactly 15.00%, backup when out (U02→U04), backup chain, low-confidence flag — done when: green — done T+11, 13 tests
- [x] T3 (6) Stock client + retry + staleness — `src/common/retry.ts`, `src/stock/*` — tests: retry then success, exhausted → unavailable (fake sleep), not_found / out-of-stock / stale flags — done when: green — done T+12, 9 tests
- [x] T4 (6) DB + audit + quotes repo + duplicate rule — `src/database/*`, `src/audit/*`, `src/quotes/quotes.repository.ts`, `quotes.rules.ts` — tests: duplicate (DQ-24110→DQ-24102), outside the 24 h window, different lines — done when: green — done T+13, 11 tests (+ approve/reject decision rules)
- [x] T5 (8) Quotes service + API + auth — `quotes.service/controller/dto`, `common/auth.guard.ts` — POST/GET/approve/reject/PATCH-501, role checks in the service, guarded transitions + audit in one txn — tests: service with fake ports (specialist → approver → approved; wrong user 403; double approve 409) — done when: green — done T+16, 5 service tests (+6 decision rules in T4)
- [x] T6 (5) Batch CLI + output + e2e smoke — `src/cli/process-drafts.ts`, `test/quotes.e2e-spec.ts` — run against the mock → `outputs/routing_results.json` matching §4 expectations — done when: file produced by running the service, e2e green — done T+16, 4 e2e tests; output produced against the mock (1 retried 503 in the log)
Total: 38 min

## 8. Acceptance checklist
| Criterion (from CHALLENGE) | Task | Evidence |
|---|---|---|
| Rules configurable + tests per tier, backup, duplicate | T2, T4 | `config/approval-rules.json`; `src/approval/approval.rules.spec.ts` (tiers, 15/25% boundaries, $25k, backup, chain); `src/quotes/quotes.rules.spec.ts` (duplicate) |
| Pricing from reporting DB; stock from API; no SAP writes | T1, T3 | `src/pricing/pricing.rules.ts`; `HttpStockClient` (`src/stock/stock.client.ts`); `ReportingRepository` has no write path |
| Every action audited | T4, T5 | `audit_log` + append-only triggers; `quotes.service.spec.ts` audit trail test; `outputs/audit_log.json` |
| Stock failure / stale handled visibly; retries | T3 | `src/stock/stock.spec.ts` (retry, exhausted → unavailable, stale); batch log shows a retried 503 |
| No quote reaches a customer without human approval | T5 | `decide()` in `src/quotes/quotes.rules.ts`; every intake starts at `pending_specialist` |
| Role-based access | T5 | `quotes.rules.spec.ts` decide table; `test/quotes.e2e-spec.ts` 401/403 |
| `outputs/routing_results.json` matches Deliverable 1 | T6 | `pnpm run process` (against mock :8080) |
| API scenarios | — | `bruno-workspace/collections/Quote Approvals` (21 requests, all checked against a live server) |
| README headings, .env.example, .chat-history | ship | `/lite-ship` |

## 9. Part 1 talking points
- **Build:** a NestJS service. Intake POSTs a draft; we price it from the reporting snapshot, check stock through the API with retries, route it to the right approver (backup applied), and audit everything. Plus an approve/reject API and a batch run for the 10 samples.
- **Stub:** header auth (prod: SSO/JWT), quote edit (explain reprice → reroute), SQLite (prod: Postgres), CSV snapshot (prod: read-only replica). Nothing writes to SAP.
- **D1:** bad or missing data turns into flags for the specialist, never a block or a guess, and every path ends with a human approval.
- **Proof:** table-driven rule tests per tier, backup and duplicate; the output file is generated by running against the mock with a 10% failure rate.
