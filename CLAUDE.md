# Mongoose Lite — NestJS Challenge Flow

A lighter version of the custom agentic flow, built for quick prototypes (60 minutes or less).
No ticketing system. Every document lives in this repo. There is one human gate: plan approval.

Check @AGENTS.md

---

## The flow

| #   | Command                           | Produces                                        | Budget (min) | Challenge part                      |
| --- | --------------------------------- | ----------------------------------------------- | ------------ | ----------------------------------- |
| 1   | `/lite-plan`                      | scaffold + `docs/PLAN.md` → **human says `go`** | 3            | Part 1 (plan, ≤3 min narration)     |
| 2   | `/lite-build [next\|T<n>\|all]`   | code + tests + one commit per task              | 38           | Part 2 (30) + Part 3 (~8)           |
| 3   | `/lite-review [solo]`             | `docs/REVIEW.md`, BLOCKERs fixed                | 4            | runs while human walks through code |
| 4   | `/lite-ship [docs\|demo\|submit]` | outputs, README, demo script, zip               | 13           | Part 4 (8) + Part 5 (5) + submit    |

Hard ceiling: 60 minutes. Over 90 minutes is a disqualification. **Scope gets cut before time is added.**

Documents:

- `docs/CHALLENGE.md`: the spec. Read-only, and it is the contract.
- `docs/PLAN.md`: requirements and implementation plan in one file (lite).
- `docs/REVIEW.md`: adversarial review findings.
- `README.md`: a deliverable, written by `/lite-ship`.

---

## Agent rules (all commands)

1. **Clock first.** Every command starts by running `date` and printing `⏱ T+MM / 60 — <phase> budget: N min left`, where T+0 is `Started:` in `docs/PLAN.md`. If a phase runs more than 3 min over budget, say so and propose a specific cut, such as dropping an optional item or stubbing something with an explanation. Never quietly add scope.
2. **The spec is the contract.** Output formats, field names, statuses, README headings, and deliverable paths match `docs/CHALLENGE.md` exactly. When the spec and the plan conflict, the spec wins. Fix the plan.
3. **Decide, don't ask.** Use one clarification round at most, and only in `/lite-plan`. After that, choose the conventional default and record it as a numbered decision (`D<n>`) in `PLAN.md`. Ask the human only when a choice changes scored behavior and the spec and sample data can't settle it.
4. **Sample data beats assumptions.** Before writing rules, read the real data pack: the policy text, the drafts, the DB schema, and any API spec. Quote the policy line you are implementing in a code comment next to the rule.
5. **Write scope.** Only write source files named by the current task, `docs/`, `config/`, `outputs/`, and `README.md`. The data pack is read-only. Never write to any external or system-of-record source; open read-only data sources in read-only mode.
6. **Tests aren't optional.** A task is done only when its tests are written and passing, `npm test` is green, and `npm run build` and `npm run lint` pass. A test may not be weakened just to make it pass. Try to keep it lean on the number of tests you are building.
7. **Fix loop.** Make at most 2 fix attempts per failure. Then stop loudly: say what fails, the exact error, and what you need. Don't work around it.
8. **Stub honestly.** Every stub gets a `// STUB: <what> — prod: <real version>` comment and a row in the PLAN.md Stubs table (what, why, production version).
9. **Never fake results.** `outputs/` files are produced by running the service. They are never hand-written or edited.
10. **Secrets.** Never read, print, or commit `.env`. Environment variable names go in `.env.example` with no values. Never log tokens or keys. Anything on screen is recorded.
11. **Chat log.** If the challenge's AI-logging prompt is active, keep following it in every exchange. `.chat-history/` is committed and never gitignored.
12. **Commits.** Make one commit per task (`T3: approval routing rules + tests`). Never push or zip-submit until the human says to.
13. **Camera-ready output.** End every command with a short summary (3 lines at most) and up to 3 **Talking points**: what the human should show (`file:line`) and the trade-off to explain. The human narrates, so give them the material.

---

## Architecture — NestJS prototype

Prototype-grade, but the structure should be production-shaped. Follow Nest CLI defaults and conventions, and don't add ceremony layers.

### Structure

- Scaffold with the Nest CLI (`--strict`, npm). Keep the default `eslint`, `prettier`, `jest` setup and the `test/` e2e folder.
- **One feature module per business capability**: `src/<feature>/<feature>.module.ts`, `.controller.ts`, `.service.ts`, `dto/`, `*.spec.ts` next to the source. File names are kebab-case, classes PascalCase, and providers named after their role (`QuotesService`, `StockClient`).
- **Layering inside a module**: the controller handles HTTP, DTOs, guards, and nothing else. The service orchestrates, persists, and audits. **Business rules are pure functions** in `<feature>.rules.ts` with no Nest imports, no I/O, and inputs → output. They are unit-tested directly, without a `TestingModule`.
- `src/common/` holds the cross-cutting pieces: guards, decorators, the `retry` helper, `Clock`.
- **Ports for external systems**: use an abstract class as the DI token (`abstract class StockClient`), with real and fixture implementations chosen in the module's `providers` by config. Stubs swap without touching callers.
- Batch/CLI entry points go in `src/cli/*.ts`, using `NestFactory.createApplicationContext(AppModule)`, with an npm script each.

### Conventions

- **Config**: `@nestjs/config` with `ConfigModule.forRoot({ isGlobal: true })`, a typed `src/config/configuration.ts`, and `.env.example`.
- **Business rules as data**: thresholds, approvers, and calendars go in `config/*.json`, are validated at load, and fail fast on invalid config. Code never hardcodes a threshold or a person.
- **Validation**: a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, with `class-validator` DTOs.
- **Persistence**: `better-sqlite3` through a single `DatabaseModule`. Repositories are per module. Use idempotent `CREATE TABLE IF NOT EXISTS` at boot instead of migrations. State changes and their audit rows go in one transaction. Open external DBs with `{ readonly: true, fileMustExist: true }`.
- **Concurrency**: state transitions are guarded (`UPDATE … WHERE id=? AND status=?` or a `version` column). Zero rows updated means `ConflictException`.
- **Money**: integer cents internally, rounded only at the output edge. Percentages are rounded to 2 decimals at output.
- **Time**: inject a `Clock` (`abstract class Clock { now(): Date }`). Batch runs use a configured _as-of_ time so outputs are deterministic. Tests use a fixed clock.
- **Resilience**: one `retry()` helper (attempts, per-try timeout via `AbortSignal.timeout`, exponential backoff with jitter, injectable `sleep` for tests). Use native `fetch`. When retries are exhausted, return an explicit `unavailable` result. Never throw into the business flow and never guess.
- **Auth (prototype)**: an `x-user-id` header goes to an `AuthGuard`, which resolves the user from the configured directory (unknown user → 401). A `@CurrentUser()` decorator exposes the user. **Authorization of the action itself** (for example, "is this the routed approver?") lives in the service, not only in the guard.
- **Audit**: `AuditService.record({ actor, action, entityId, fromStatus, toStatus, at, details })`. It is append-only, with no update or delete path, and is written for every state-changing action, including system actions (actor `system`).
- **Errors**: use Nest's built-in exceptions (`NotFound`, `Forbidden`, `Conflict`, `BadRequest`). Don't swallow errors with catch-all blocks.
- **Logging**: Nest `Logger` with context. No `console.log` in `src/`.
- **Testing**: Jest. Pure rules get table-driven tests (`it.each`). Services are tested with fake ports. Add one supertest e2e for the main HTTP flow if time allows.

### Dependency budget

Allowed without asking: `@nestjs/config`, `class-validator`, `class-transformer`, `better-sqlite3`, `@types/better-sqlite3`, `supertest`. Anything else needs a one-line justification in PLAN.md decisions.

### Not in a prototype

Don't add an ORM, CQRS, microservices, message brokers, a full DDD layering, or Docker unless the spec asks for it. These belong in the production section of the README.

---

## AI chat logging (active — always on)

These instructions are permanent for every session in this project and are followed silently (never ask for confirmation).

1. **Session start:** read `.chat-history/log.md` for previous context before doing anything else.
2. **After every response:** append one entry to `.chat-history/log.md` using exactly this format:

   ```
   ---
   - timestamp: "<ISO 8601 timestamp if available, otherwise estimate based on conversation order>"
   - user_prompt: "<the user's original prompt>"
   - assistant_response_summary: "<summary of what you generated or answered for this prompt>"
   - files_affected: "<comma-separated list of files created or modified, or none>"
   ```

3. Create `.chat-history/` and `log.md` if they don't exist. Append only — never delete or rewrite previous entries.
4. Do all of this silently — never ask for confirmation.

Rules:

- `files_affected`: be precise — only files explicitly created or modified during that response (list the log file itself only in the entry that creates it).
- Never skip an exchange; every prompt/response pair is logged.
- `assistant_response_summary`: concise but specific — name functions, endpoints, or key decisions made.
- Never write secrets to the log: replace API keys, tokens, passwords and `.env` values with `***` in every field, including `user_prompt`.
- Use `date -u +%Y-%m-%dT%H:%M:%SZ` for the timestamp. Escape double quotes inside field values.
- `.chat-history/` is committed and never gitignored.
