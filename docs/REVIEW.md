# Adversarial Review — T+19
Verdict: **PASS** (no BLOCKERs; cheap fixes applied)

Reviewers ran in parallel: R1 spec & rules (independent Python recompute of all 10 drafts — all match `outputs/routing_results.json`), R2 reliability & security, R3 deliverables & quality.

| # | Sev | Lens | Where | Problem | Fix | Status |
|---|-----|------|-------|---------|-----|--------|
| 1 | CHEAP | R1 | `src/approval/approval.rules.ts` `determineTier` | Tier compared on the 2-decimal value: 15.004% rounded to 15.00 → specialist-only, but the policy says "over 15%" goes to a manager | Compare unrounded with a 1e-6 float-noise tolerance; test row `15.004% → regional manager` | FIXED |
| 2 | CHEAP | R2 | `src/quotes/quotes.rules.ts` `decide` | The specialist who signed off could also approve as the routed approver if one person held both roles (self-approval) | Human decision: allowed by design (D14); both steps still audited. Test row asserts it is allowed | REJECTED: accepted behavior per human |
| 3 | CHEAP | R1+R2 | `src/quotes/quotes.rules.ts` `decide` | Manager/VP tier with no available approver (chain exhausted and VP out) parked the quote in `pending_approver` with nobody able to act | Specialist approve → 409 "manual assignment required" (quote stays visible, flag already present); test row | FIXED |
| 4 | CHEAP | R2 | `src/stock/stock.spec.ts` | The per-try timeout (`AbortSignal.timeout`) was never exercised | Test: a hung fetch is aborted after 5 ms × 3 attempts → `unavailable` | FIXED |
| 5 | CHEAP | R3 | `src/reporting/reporting.repository.ts`, PLAN Stubs | Stub table and STUB comments didn't match up | Added a STUB comment for the CSV snapshot + a fixture StockClient row | FIXED |
| 6 | CHEAP | R3 | `.env.example` | `OUTPUT_DIR` was read by the CLI but not listed | Added | FIXED |
| 7 | NOTE | R3 | `outputs/routing_results.json` DQ-24110 | Duplicate row has null `net_total`/`effective_discount_pct` | Human decision during planning (D5): duplicates are not priced or routed | REJECTED: deliberate, documented decision |
| 8 | NOTE | R2 | `src/stock/stock.client.ts` | The 503 `retry_after_seconds` is ignored (own backoff ≈1.4 s total) | README limitation; prod: honor Retry-After + circuit breaker (D12) | NOTE |
| 9 | NOTE | R1 | `src/cli/process-drafts.ts` | One bad draft (unknown customer → 400) stops the batch before outputs are written | Two more weeks: per-draft error rows / dead-letter list | NOTE |
| 10 | NOTE | R3 | `package.json` `process` | Batch needs the stock mock on :8080 (otherwise every quote gets the "stock unavailable" flag after retries); the mock fails 10% of calls at random, so a run can differ | README How to Run: start the mock first; `STOCK_CLIENT=fixture` for offline runs | NOTE |
| 11 | NOTE | R1 | output JSON | JSON drops trailing zeros (728.8, 47652); values are rounded to 2 decimals | One line in README | NOTE |
| 12 | NOTE | R3 | `src/quotes/quotes.controller.ts` | `@Roles(['intake_service'])` is a literal; the other role names come from config | Two more weeks: role names in config / IdP groups | NOTE |
| 13 | NOTE | R3 | `README.md` | Still the scaffold README | `/lite-ship docs` | NOTE |

Evidence after fixes: `pnpm test` 54 passed · `pnpm run test:e2e` 4 passed · build + lint clean · `pnpm run process` output byte-identical to before.
