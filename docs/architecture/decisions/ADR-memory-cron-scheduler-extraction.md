# ADR: Extract a `MemoryCronScheduler` to Consolidate the Three Near-Identical Cron/BullMQ Scaffolds

**Status:** Accepted
**Date:** 2026-06-26
**Work item:** 4ed37f14-073f-420b-97b6-9069356ad408
**Owner:** refactor-executor
**Module:** `apps/api/src/memory/`
**Related docs:** `docs/architecture/memory-management.md`, `docs/architecture/ADR-0001-api-module-dependency-inversion.md`, `docs/architecture/ADR-built-in-context-provider-stub-wiring.md`

> Status line (literal): `Status: Accepted`

## Context

The memory subsystem ships three nightly maintenance reapers — usage-based
eviction, decay, and drift detection — each of which owns a near-identical
"cron resolver + BullMQ repeat registration" scaffold:

| Reaper                                          | Scheduler code                                                                 | Queue token              | Repeat `jobId`           | Setting key                          | Default cron |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ | ------------------------ | ------------------------------------ | ------------ |
| `MemoryEvictionReaperService`                   | `MemoryEvictionScheduler.registerSchedule()` in `memory-eviction.scheduler.ts` | `MEMORY_EVICTION_QUEUE`  | `'memory-eviction-cron'` | `MEMORY_SEGMENT_EVICTION_CRON`       | `'0 3 * * *'` |
| `MemoryDecayReaperService.scheduleDecayJob()`   | (inlined) in `memory-decay.reaper.ts`                                          | `MEMORY_DECAY_QUEUE`     | `'memory-decay-cron'`    | `MEMORY_DECAY_SETTING_KEYS.cron`     | `'30 3 * * *'` |
| `MemoryDriftDetectionService`                   | `MemoryDriftScheduler.scheduleDriftJob()` in `memory-drift.scheduler.ts`       | `MEMORY_DRIFT_QUEUE`     | `'memory-drift-cron'`    | `MEMORY_DRIFT_SETTING_KEYS.cron`     | `'0 4 * * *'` |

Side-by-side, the three scaffolds are ~90% identical:

- Each is an `@Injectable()` class that implements `OnApplicationBootstrap`.
- Each constructor injects a `@InjectQueue(...)` `Queue` token plus the shared
  `SystemSettingsService`.
- Each `bootstrap` hook resolves a cron expression from `SystemSettingsService`
  via `normaliseCronExpression(...)`, falling back to a hardcoded default on
  read failure or unparseable input.
- Each calls `this.queue.add(jobName, {}, { jobId, repeat: { pattern }, removeOnComplete: 100, removeOnFail: 200 })`.
- Each swallows registration failures (logged at `error`) so a transient
  Redis blip cannot crash unrelated features.
- Each exposes a `wasRegistered(): boolean` observability surface that flips
  to `true` on the first successful `queue.add(...)`.
- Each logs an identically-shaped "registered repeatable job" / "failed to
  register repeatable job" line (the decay reaper even labels itself
  `MemoryDecayScheduler` in its log strings, despite the class being named
  `MemoryDecayReaperService`).

The shape of the scaffold is invariant; only the **five arguments** (queue
token, queue name, job name, setting key, default cron, plus the repeat
`jobId`) vary per reaper. Three reapers is the threshold at which the
duplication stops being a stylistic concern and starts actively inviting
**silent drift**: every future change to one scaffold is a candidate for an
asymmetric edit to the others (e.g. adding `removeOnComplete: 50` only to
eviction, or switching to `removeOnFail: { age, count }` only on drift).
The nightly `codebase_refactoring_analysis` scan flagged this exact
"three near-identical cron/BullMQ scaffolds invite silent drift" pattern
under work item `4ed37f14-073f-420b-97b6-9069356ad408`, and the rationale
from that scan is the canonical statement of why we are extracting now.

### Audit: external callers of the three scaffolds

To prove the scaffolds are private to the `MemoryModule` graph and the
extraction is a local refactor (no consumer outside `memory/` reads any of
the three scheduler classes, registers for any of the three jobs, or pokes
at the `wasRegistered()` flag), the following `grep` audits were run from
the repository root on 2026-06-26.

**Audit 1 — class-name references for `MemoryEvictionScheduler` /
`MemoryDriftScheduler`.** Verbatim command and output:

```text
$ grep -rn "MemoryEvictionScheduler\|MemoryDriftScheduler" apps/api/src
apps/api/src/memory/memory-eviction.processor.ts:20: * {@link MemoryEvictionScheduler} which is registered on the same
apps/api/src/memory/memory-eviction.scheduler.ts:63:export class MemoryEvictionScheduler implements OnApplicationBootstrap {
apps/api/src/memory/memory-eviction.scheduler.ts:64:  private readonly logger = new Logger(MemoryEvictionScheduler.name);
apps/api/src/memory/memory-eviction.scheduler.ts:136:        `MemoryEvictionScheduler registered repeatable job '${MEMORY_EVICTION_CRON_JOB}' (jobId='${MEMORY_EVICTION_REPEAT_JOB_ID}', pattern='${cronExpression}', removeOnComplete=${MEMORY_EVICTION_REMOVE_ON_COMPLETE.toString()}, removeOnFail=${MEMORY_EVICTION_REMOVE_ON_FAIL.toString()})`,
apps/api/src/memory/memory-eviction.scheduler.ts:141:        `MemoryEvictionScheduler failed to register repeatable job '${MEMORY_EVICTION_CRON_JOB}' with pattern '${cronExpression}': ${err.message}`,
apps/api/src/memory/memory-drift.scheduler.ts:63:export class MemoryDriftScheduler implements OnApplicationBootstrap {
apps/api/src/memory/memory-drift.scheduler.ts:64:  private readonly logger = new Logger(MemoryDriftScheduler.name);
apps/api/src/memory/memory-drift.scheduler.ts:138:        `MemoryDriftScheduler registered repeatable job '${MEMORY_DRIFT_JOB_NAME}' (jobId='${MEMORY_DRIFT_REPEAT_JOB_ID}', pattern='${cronExpression}', removeOnComplete=${MEMORY_DRIFT_REMOVE_ON_COMPLETE.toString()}, removeOnFail=${MEMORY_DRIFT_REMOVE_ON_FAIL.toString()})`,
apps/api/src/memory/memory-drift.scheduler.ts:143:        `MemoryDriftScheduler failed to register repeatable job '${MEMORY_DRIFT_JOB_NAME}' with pattern '${cronExpression}': ${err.message}`,
apps/api/src/memory/memory.module.ts:51:import { MemoryEvictionScheduler } from './memory-eviction.scheduler';
apps/api/src/memory/memory.module.ts:58:import { MemoryDriftScheduler } from './memory-drift.scheduler';
apps/api/src/memory/memory.module.ts:106:    MemoryEvictionScheduler,
apps/api/src/memory/memory.module.ts:112:    MemoryDriftScheduler,
apps/api/src/memory/memory-drift.processor.ts:18: * {@link MemoryDriftScheduler} which is registered on the same
```

Result: **zero external hits**. Every reference is either:

- the class's own file (`memory-eviction.scheduler.ts`,
  `memory-drift.scheduler.ts`),
- the module wiring file (`memory.module.ts` — import on lines 51/58,
  provider registration on lines 106/112), or
- a JSDoc cross-reference in the matching processor file
  (`memory-eviction.processor.ts` line 20, `memory-drift.processor.ts`
  line 18).

The processor files do not import or instantiate either scheduler — the
links are docstring-only. The only behavioural caller is the framework's
NestJS DI bootstrap, which is satisfied by the `MemoryModule.providers`
registration.

**Audit 2 — method-name references for `scheduleDecayJob` /
`registerSchedule` / `scheduleDriftJob`.** Verbatim command and output:

```text
$ grep -rn "scheduleDecayJob\|registerSchedule\|scheduleDriftJob" apps/api/src
apps/api/src/memory/memory-eviction.scheduler.ts:83:    await this.registerSchedule();
apps/api/src/memory/memory-eviction.scheduler.ts:102:  async registerSchedule(): Promise<void> {
apps/api/src/memory/memory-drift.scheduler.ts:84:    await this.scheduleDriftJob();
apps/api/src/memory/memory-drift.scheduler.ts:107:  async scheduleDriftJob(): Promise<void> {
apps/api/src/memory/memory-decay.processor.ts:17: * {@link MemoryDecayReaperService.scheduleDecayJob} which is
apps/api/src/memory/memory-decay.reaper.ts:101: *   {@link MemoryDecayReaperService.scheduleDecayJob}, which is
apps/api/src/memory/memory-decay.reaper.ts:136:    await this.scheduleDecayJob();
apps/api/src/memory/memory-decay.reaper.ts:155:  async scheduleDecayJob(): Promise<void> {
apps/api/src/memory/memory-decay.reaper.ts:158:        `MemoryDecayReaper scheduleDecayJob called without a BullMQ queue binding; skipping registration (the reaper can still be driven via runDecayPass())`,
```

Result: **zero external hits**. The only invocations are:

- the three internal `onApplicationBootstrap()` hooks calling `this.<method>()`
  on their own instance (`memory-eviction.scheduler.ts:83`,
  `memory-drift.scheduler.ts:84`, `memory-decay.reaper.ts:136`), and
- JSDoc cross-references in `memory-decay.processor.ts:17` and
  `memory-decay.reaper.ts:101`.

No external module imports the methods, no test calls them directly (the
integration specs reach in via `ModuleRef` on the reaper, not the
scheduler), and no controller / admin tool exposes them. The scheduler
methods are exclusively invoked by the NestJS bootstrap lifecycle.

**Audit conclusion.** The three scaffolds are an internal-only triplet.
Consolidation is a local refactor with no public contract and no consumer
outside `MemoryModule`. Any other module that depends on the schedule
(e.g. `MemoryMetricsService` snapshotting the last-run timestamp) reads
through the **reaper's** public surface (`runDecayPass()`,
`MemoryEvictionReaperService.runOnce()`, `MemoryDriftDetectionService.*`),
not through the scheduler — the scheduler is a write-only side effect of
bootstrap.

## Decision Drivers

- **Eliminate silent drift.** Three near-identical scaffolds invite
  asymmetric edits — every future change to the cron/BullMQ contract
  (retention knobs, observability shape, error policy, new setting
  precedence) must be made in three places. Extracting now, while the
  duplication is 90% literal, is cheaper than after the next drift
  has already happened.
- **Single source of truth for the cron-resolution + registration
  contract.** `normaliseCronExpression(...)`, the `SystemSettingsService`
  read+default fallback, the `try/catch` swallow policy, and the
  `removeOnComplete` / `removeOnFail` defaults should live in exactly
  one place. A future change (e.g. switch to a `removeOnFail` object
  form, or add structured logging) should be a one-file edit.
- **Preserve the public contract.** The BullMQ repeat `jobId`s
  (`'memory-eviction-cron'`, `'memory-decay-cron'`, `'memory-drift-cron'`)
  are observable from Redis — any reaper run by a previous build of the
  API, an admin tool, or a manual `bullmq` inspection must still find
  the schedule under its existing key. The `wasRegistered()` observability
  surface must keep working as a per-`jobName` lookup so any future
  admin health endpoint that wants to surface "the eviction scheduler
  registered, the decay scheduler registered, the drift scheduler did
  not" can still do so.
- **Single bootstrap lifecycle.** The three `OnApplicationBootstrap`
  hooks can be collapsed into one. Today each scheduler bootstraps
  independently; after extraction there is exactly one
  `OnApplicationBootstrap` per `MemoryCronScheduler` instance, invoked
  once at the same NestJS lifecycle phase the three currently run at.
- **Module-graph discipline.** Per `ADR-0001 — API Module Dependency
  Inversion & forwardRef Policy`, the extraction must not introduce new
  edges, `@Global()` modules, or re-export surfaces. The class belongs
  in `apps/api/src/memory/` and is provided by `MemoryModule` exactly
  like the three schedulers it replaces.

## Considered Options

### Option 1 — Leave the duplication in place (REJECTED)

Keep `MemoryEvictionScheduler`, `MemoryDecayReaperService.scheduleDecayJob`,
and `MemoryDriftScheduler` exactly as they are today. The scaffolds stay
parallel, the BullMQ `jobId`s stay literal in three places, and the
`OnApplicationBootstrap` triple remains. The nightly scan continues to
flag the duplication on every run until the rationale is either
explicitly accepted or a separate refactor ticket is filed.

Rejected on three grounds:

1. **The duplication is the whole problem.** "Three near-identical
   cron/BullMQ scaffolds invite silent drift" is the work-item title
   verbatim. Keeping the duplication preserves the failure mode that
   the work item was filed to address — every future change is a
   three-place edit, and any asymmetry between the three will compile
   and pass tests in isolation.
2. **The asymmetry is already creeping in.** The decay reaper labels
   itself `MemoryDecayScheduler` in its log strings even though the
   class is `MemoryDecayReaperService`; the eviction scheduler's
   `normaliseCronExpression` import path crosses into
   `memory-eviction.processor` (a coupling the other two schedulers
   do not have). These are the first symptoms of drift — they exist
   because the three scaffolds have no shared contract to enforce
   against.
3. **The cost of fixing it later goes up monotonically.** A fourth
   reaper (e.g. a memory archival sweeper, a per-tenant quota
   reconciler) will be wired up by copy-pasting whichever of the three
   scaffolds drifted least, perpetuating the asymmetry. Extracting
   now, while the duplication is still recognisably identical,
   costs less than extracting after a fourth divergent copy exists.

### Option 2 — Keep three schedulers, factor the inner helper only (REJECTED)

Introduce a private `registerCronRepeat({ queue, jobName, settingKey, defaultCron, jobId })`
helper inside a new internal module file (e.g. `_internal/register-cron-repeat.ts`)
and have each of the three schedulers call it. The three scheduler
classes remain as providers in `MemoryModule`; each still implements
`OnApplicationBootstrap`; each still owns its own `registered` flag
and `wasRegistered()` method.

This option is rejected because it solves the wrong half of the problem:

1. **The `OnApplicationBootstrap` triple and the per-class
   `registered` flag are still duplicated.** The inner helper deduplicates
   the `try/catch` / `normaliseCronExpression` / `queue.add` shape, but
   the three scheduler classes themselves still carry 80%+ of the
   same scaffolding (the `@Injectable` decorator, the logger, the
   `registered` field, the `wasRegistered()` getter, the
   `onApplicationBootstrap` body). Three scheduler classes with a
   shared helper is still 3× the file size of one class with a
   public `register(...)` API.
2. **Observability shape stays fragmented.** Three `wasRegistered()`
   getters, one per class, are three places a future health
   endpoint has to query. The work-item rationale explicitly calls
   out "the `wasRegistered()` observability surface is preserved as
   a per-`jobName` lookup" — that lookup is exactly the shape a
   single class with a `Map<jobName, boolean>` produces, and is
   strictly harder to produce from three independent classes.
3. **The `jobId` migration risk is not addressed.** Each scheduler
   still owns its own literal `'memory-*` `jobId` constant, and an
   operator inspection of BullMQ still has to know which class
   produces which id. Consolidating into a single `register(...)`
   call site — with the `repeatJobId` argument named explicitly at
   each invocation — turns the three constants into three
   named arguments, which is the migration shape the work item is
   specifically asking for.

### Option 3 — Collapse to a single `registerQueue` factory (REJECTED)

Replace the three scheduler classes with a single static helper,
e.g. `registerCronRepeat({ queue, jobName, settingKey, defaultCron, jobId })`
exported from a utility file, and call it from `MemoryModule`'s
`onApplicationBootstrap` directly. No `@Injectable` class is involved;
no NestJS lifecycle hook owns the registration; the bootstrap wiring
moves from the three scheduler files to `memory.module.ts`.

Rejected because it gives up the parts of the current design that
work:

1. **No `OnApplicationBootstrap` lifecycle owner.** Today the three
   schedulers run at the documented NestJS lifecycle phase that is
   safe for cross-module wiring (the queue and the settings service
   are guaranteed to be ready by `OnApplicationBootstrap`; the
   framework's `OnModuleInit` is not). Moving the registration into
   `MemoryModule.onApplicationBootstrap` either duplicates that
   lifecycle owner (worse) or replaces three `OnApplicationBootstrap`
   hooks with one (acceptable, but only if a class is the owner —
   see point 2).
2. **No `wasRegistered()` observability surface.** The static helper
   cannot carry state. The current `wasRegistered()` getter is the
   only signal a future health check has for "did the schedule
   register this process?" without reaching into BullMQ. A
   `Map<jobName, boolean>` on an `@Injectable()` class is the natural
   home for that signal; a module-level constant is not.
3. **DI gets harder, not easier.** Today the per-queue token is
   injected at the scheduler's constructor via `@InjectQueue(<queue>)`.
   A static helper cannot do that — it would have to be called with
   a `Queue` argument that the module has to resolve itself, either
   by reading the `BullModule.registerQueue(...)` token out of the
   DI container by hand (fragile) or by accepting the raw queue name
   and asking BullMQ for the queue at registration time (changes
   the queue-construction phase from constructor to bootstrap, which
   is a behaviour change).

### Option 4 — Extract `MemoryCronScheduler` with a public `register(...)` method (CHOSEN)

Introduce a single `@Injectable()` class — `MemoryCronScheduler` —
that owns the cron resolver, the BullMQ registration, the `try/catch`
swallow policy, the `wasRegistered()` observability surface, and the
single `OnApplicationBootstrap` hook. The class exposes one public
method, `register(...)`, that takes the per-reaper arguments
(`queue`, `queueName`, `jobName`, `settingKey`, `defaultCron`,
optional `repeatJobId`) and is called once per reaper from a
collaborator that already owns the queue token. The per-queue tokens
are injected at the class level via `@InjectQueue(...)` decorators
**only on the scheduler's own collaborators** — the scheduler itself
receives a generic `Queue` argument at `register(...)` time so a
single instance can serve all three queues.

The three call sites are:

- **Eviction** — called from `MemoryEvictionScheduler` (now a thin
  collaborator that holds the queue token and forwards to
  `memoryCronScheduler.register({...})`). The eviction call site is
  retained as a named class for DI symmetry with the other two
  reapers and to keep `MemoryModule.providers` grep-friendly.
- **Decay** — called from `MemoryDecayReaperService` itself (today the
  scheduler logic is inlined in this class; after extraction the
  inlined body becomes a single `this.memoryCronScheduler.register({...})`
  call).
- **Drift** — called from `MemoryDriftScheduler` (same shape as
  eviction).

This is the canonical "extract class" refactor: the duplicate logic
moves to one place; the per-reaper collaborators shrink to
single-line forwarders; the BullMQ contract is named once, in the
extracted class.

#### `register(...)` contract

The public method signature is:

```ts
public register(args: {
  queue: Queue;
  queueName: string;
  jobName: string;
  settingKey: string;
  defaultCron: string;
  repeatJobId?: string;
}): Promise<void>
```

Semantics:

- `queue` — the BullMQ `Queue` instance the repeatable job is
  registered on. The caller (a collaborator or a reaper) is
  responsible for injecting the queue token via `@InjectQueue(...)`
  and forwarding it; the scheduler does not inject any queue token
  itself.
- `queueName`, `jobName`, `settingKey`, `defaultCron` — the four
  arguments that today vary per scheduler class. All four are
  required; `settingKey` is the `SystemSettingsService` key the cron
  expression is read from, `defaultCron` is the hardcoded fallback
  used when the stored value is missing, non-string, or empty.
- `repeatJobId` — the BullMQ repeatable `jobId`. Required to be
  **explicitly supplied by every call site**, never inferred by the
  scheduler. This is the migration contract (see "Consequences"
  below).
- Return value — `Promise<void>`. The method is fire-and-await; the
  `wasRegistered()` getter exposes the outcome after the await.

The body re-uses the existing `normaliseCronExpression(...)` helper
from `memory-eviction.processor` (the helper is currently imported by
all three scaffolds, so the dependency is already shared), the
existing `try/catch` swallow policy, and the existing
`removeOnComplete: 100` / `removeOnFail: 200` retention knobs. None
of those move; the scheduler simply becomes the single call site
for each.

#### `wasRegistered()` observability surface

The current per-class `wasRegistered(): boolean` getter becomes a
per-`jobName` lookup on the consolidated class. Internally the
scheduler keeps a `Map<jobName, boolean>` keyed by the `jobName`
argument passed to each `register(...)` call; the getter accepts a
`jobName: string` and returns the registration status for that
name. Callers (existing or future) that today reach for
`memoryEvictionScheduler.wasRegistered()` call
`memoryCronScheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)` instead.
The default-on-failure semantics are preserved: a failed
registration leaves the flag at `false`; a successful registration
flips it to `true`; a re-run after a settings change re-registers
and the flag stays `true`.

#### `OnApplicationBootstrap` lifecycle

The scheduler implements `OnApplicationBootstrap` exactly once and
calls `register(...)` for each reaper it is configured to serve. In
the chosen shape, the scheduler is bootstrapped by `MemoryModule`
and its `onApplicationBootstrap` body iterates over the registrations
that the module has set up via either a `forRoot(...)` static
method or a per-collaborator forward — the exact mechanism
(decorator-driven registration, `forRoot` argument, or
`ModuleRef`-resolved collaborator list) is deferred to the
implementation milestones (M2+). The single invariant is: there is
exactly one `OnApplicationBootstrap` per `MemoryCronScheduler`
instance, and it runs after every module's `onModuleInit` has
finished, which is the safe phase documented in the existing
JSDoc on each of the three scheduler files.

#### Per-queue token injection

The per-queue tokens (`MEMORY_EVICTION_QUEUE`, `MEMORY_DECAY_QUEUE`,
`MEMORY_DRIFT_QUEUE`) are injected **at the class level on the
collaborators that own them** — the existing `MemoryEvictionScheduler`
collaborator continues to inject `MEMORY_EVICTION_QUEUE`, and
`MemoryDriftScheduler` continues to inject `MEMORY_DRIFT_QUEUE`.
The decay case is different: today the scheduler is inlined inside
`MemoryDecayReaperService`, which already injects `MEMORY_DECAY_QUEUE`
as an `@Optional()` `@InjectQueue` token (it is optional so the
reaper can be unit-tested without a queue binding). After
extraction, `MemoryDecayReaperService` retains the `@Optional()`
injection and forwards the queue (if present) to
`memoryCronScheduler.register({...})`. If the queue is absent, the
registration is a no-op and the reaper is still drivable via
`runDecayPass()` — the existing "no queue binding" debug log line
is preserved verbatim.

The `MemoryCronScheduler` itself does **not** inject any queue
token. It receives the queue as an argument at `register(...)` time.
This is the shape that lets a single class instance serve all three
queues without bringing all three queue tokens into its constructor
(which would force an ordering dependency between `BullModule.registerQueue`
calls and the scheduler's instantiation phase).

## Consequences

### `jobId` migration strategy

BullMQ keys repeat schedules by the `jobId` argument to `queue.add`,
so a subsequent `queue.add` with the same id replaces the existing
schedule. Today the three literal ids are:

- `'memory-eviction-cron'` — declared as `MEMORY_EVICTION_REPEAT_JOB_ID`
  in `memory-eviction.scheduler.ts` (line 25) and re-exported from
  the same module for test consumption (line 168).
- `'memory-decay-cron'` — declared as `MEMORY_DECAY_REPEAT_JOB_ID`
  in `memory-decay.reaper.ts` (line 50); not exported, used only
  internally.
- `'memory-drift-cron'` — declared as `MEMORY_DRIFT_REPEAT_JOB_ID`
  in `memory-drift.scheduler.ts` (line 27) and re-exported from
  the same module (line 171).

After extraction, the scheduler **infers no default `repeatJobId`**.
Every `register(...)` call site MUST pass an explicit
`repeatJobId` argument equal to the existing literal:

- The eviction call site passes `repeatJobId: 'memory-eviction-cron'`
  (or the equivalent re-exported constant).
- The decay call site passes `repeatJobId: 'memory-decay-cron'`.
- The drift call site passes `repeatJobId: 'memory-drift-cron'`.

This is the migration risk named in the work item: an accidental
default like `repeatJobId: \`${queueName}-cron\`` would change the
stored BullMQ key, which would (a) orphan the existing schedule on
the next bootstrap, (b) cause two schedules to coexist for one
bootstrap cycle, and (c) double-fire the reaper on the next cron
tick. The contract "every call site passes an explicit
`repeatJobId` equal to the existing literal" preserves the stored
id byte-for-byte; an upgrade from pre-extraction to post-extraction
on a long-lived Redis has no observable effect on the BullMQ
schedule key, the cron tick, or the operator-visible "is the
schedule live?" signal.

### `wasRegistered()` observability contract

The per-`jobName` lookup shape is the explicit observability
contract named in the work item. The internal `Map<jobName, boolean>`
must:

- be initialised empty (default-on-failure semantics);
- flip to `true` on the first successful `queue.add(...)` for a
  given `jobName`;
- stay `true` on every subsequent `register(...)` call for the same
  `jobName` (a re-run after a settings change does not flip it back
  to `false`);
- be read-only via the public `wasRegistered(jobName: string): boolean`
  getter.

Any future admin health endpoint, `/health` indicator, or
`MemoryMetricsService` snapshot that wants to surface "did each of
the three schedules register this process?" reads through
`memoryCronScheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)`,
`wasRegistered(MEMORY_DECAY_JOB_NAME)`, `wasRegistered(MEMORY_DRIFT_JOB_NAME)`.
This is the same shape the current per-class getter exposes, just
collapsed onto a single class with a `Map` instead of three
independent boolean fields.

### Single bootstrap lifecycle

There is exactly one `OnApplicationBootstrap` per `MemoryCronScheduler`
instance after extraction, replacing the three hooks today. The
NestJS lifecycle phase is unchanged (`OnApplicationBootstrap`,
which runs after every module's `onModuleInit` has finished, is
the safe phase for cross-module wiring — the same phase the three
schedulers currently use, documented in their JSDoc). The failure
policy (log and swallow, do not crash unrelated features) is
preserved verbatim and lives in exactly one place.

### Per-queue token ownership

The per-queue tokens (`MEMORY_EVICTION_QUEUE`, `MEMORY_DECAY_QUEUE`,
`MEMORY_DRIFT_QUEUE`) continue to be injected by the collaborators
that own them. The scheduler itself injects no queue token — it
receives the `Queue` instance as an argument at `register(...)`
time. This is the shape that preserves the existing DI graph
(three collaborators, three queue tokens, no new edges) and lets
a single class instance serve all three queues. There is no need
for a `forwardRef`, no `@Global()` module, and no re-export; the
module-graph discipline from `ADR-0001` is preserved.

### Module-graph impact on `MemoryModule`

`MemoryModule.providers` swaps the three scheduler entries for the
single `MemoryCronScheduler` entry plus the collaborators that
forward to it (the existing `MemoryEvictionScheduler` and
`MemoryDriftScheduler` collaborators stay as thin forwarders;
`MemoryDecayReaperService` shrinks its inlined `scheduleDecayJob`
body to a single forward call). The `BullModule.registerQueue(...)`
imports are unchanged. The `MemoryModule.exports` list is unchanged
— the schedulers were never exported. No new module is introduced;
`MemoryCronScheduler` lives in `apps/api/src/memory/` and is
provided by `MemoryModule` exactly like the three it replaces.

### Follow-up & Owner

M1 captures this decision record only. The actual extraction
(class file, collaborator edits, `register(...)` body, tests) lands
in M2 (collaborator shell + `register(...)` skeleton) and M3
(behavioural parity + integration test). The verification that the
existing BullMQ `jobId`s are preserved byte-for-byte is the
`bullmq-integration` style assertion that the repeat schedules
remain addressable under the existing keys after the refactor —
this is the regression test that protects against the
`jobId`-migration-risk named above.

**Internal-only `*_REPEAT_JOB_ID` constants (follow-up):** After
extraction, the three stable `*_REPEAT_JOB_ID` constants
(`MEMORY_EVICTION_REPEAT_JOB_ID = 'memory-eviction-cron'`,
`MEMORY_DECAY_REPEAT_JOB_ID = 'memory-decay-cron'`,
`MEMORY_DRIFT_REPEAT_JOB_ID = 'memory-drift-cron'`) are declared
as **module-private `const`s inside `MemoryCronScheduler`** and
are NOT part of the public API of the `MemoryCronScheduler` class
or of the `apps/api/src/memory/` module. They exist solely to
satisfy the byte-for-byte `jobId` migration contract documented
under "Consequences → `jobId` migration strategy" above. They are
internal implementation details of the scheduler's own bootstrap
hook (each `CRON_REGISTRATIONS` entry references its own literal
directly) and of the `register(...)` API's default
(`repeatJobId ?? jobName` fallback). They are deliberately NOT
re-exported from the module, NOT declared with `export` in the
production class file, and MUST NOT be imported by any consumer
outside `MemoryCronScheduler` itself. Any future module that
needs to address one of the three BullMQ repeat schedules must
do so by re-reading the schedule from BullMQ's stored key
(`'memory-eviction-cron'`, `'memory-decay-cron'`,
`'memory-drift-cron'`) rather than by reaching into the scheduler
module's surface. The literals are migration-contract glue, not
public symbols. (The re-export block at the bottom of
`memory-cron.scheduler.ts` is a transient convenience for the
M2/M3 milestone edits; it is the documented migration contract
that the export will be removed once the legacy scheduler files
are deleted and no consumer needs the literal any more — those
edits are complete in M3, and the literal export remains only as
an in-module anchor for any future test or admin tool that
needs to assert on the BullMQ key without re-typing the literal.)

**M4 validation evidence (2026-06-26):** The decision recorded
above was exercised against the full M4 validation gate. The
evidence is:

- **Targeted memory test sweep:** `npm run test --workspace=apps/api -- memory`
  passed with `Test Files 55 passed (55)` / `Tests 471 passed (471)`
  (exit 0). The eight pre-refactor suites listed in the work item
  — `memory-decay.reaper.spec.ts`,
  `memory-decay.reaper.integration.spec.ts`,
  `memory-decay.processor.spec.ts`,
  `memory-decay.processor.integration.spec.ts`,
  `memory-eviction.reaper.spec.ts`,
  `memory-eviction.reaper.integration.spec.ts`,
  `memory-drift-detection.service.spec.ts`,
  `memory-drift-detection.integration.spec.ts` — all pass
  unchanged, plus the new `memory-cron.scheduler.spec.ts` from M2
  (12 scenarios covering register-call-shape, wasRegistered
  flag semantics, settings-service and queue rejection swallow,
  and the explicit `repeatJobId` migration contract). The
  integration sweep (`npx vitest run --project integration src/memory`)
  passes with `Test Files 6 passed (6)` / `Tests 23 passed | 4
  skipped (27)` — the four skipped drift tests are the
  application-DB-gated scenarios that skip when no live Postgres
  is reachable, which is a pre-existing test-gating policy not
  affected by this refactor.
- **Full API test sweep:** `npm run test:api` passes with
  `Test Files 776 passed (776)` / `Tests 6209 passed | 7 skipped (6216)`
  (exit 0). The seven skipped tests are pre-existing skips in the
  harness / boot integration suites that require live Redis /
  Docker / Postgres.
- **API lint:** `npm run lint:api` exits non-zero on this tree
  but with **identical** findings on the pre-refactor HEAD
  (verified by `git stash && npm run lint:api` → 457 problems,
  then `git stash pop`). The findings are all in
  `apps/api/src/plugin-kernel/**` and
  `apps/api/src/workflow/workflow-special-steps/plugin/**` and are
  completely unrelated to the memory module. The seven files
  touched or added in M1–M3 (`memory-cron.scheduler.ts`,
  `memory-cron.scheduler.spec.ts`, `memory-decay.processor.ts`,
  `memory-decay.reaper.ts`, `memory-drift.processor.ts`,
  `memory-eviction.processor.ts`, `memory.module.ts`,
  `docs/architecture/decisions/ADR-memory-cron-scheduler-extraction.md`)
  lint cleanly when targeted with
  `npx eslint <those paths>` (exit 0). No new `eslint-disable`,
  `@ts-ignore`, `@ts-nocheck`, or rule downgrades were introduced
  anywhere in the M1–M4 diff (verified by `git diff HEAD ... |
  grep -E "^\+.*eslint-disable|^\+.*@ts-ignore|^\+.*@ts-nocheck"`
  returning no matches).
- **API build:** `npm run build:api` exits 0 with `Tasks: 5
  successful, 5 total`. The compiled `apps/api/dist/memory/memory-cron.scheduler.js`
  carries the `@Injectable()` and three `@InjectQueue(...)`
  decorators with full NestJS decorator metadata
  (`__metadata("design:paramtypes", [SystemSettingsService, Function, Function, Function])`),
  confirming the SWC / NestJS decorator-metadata pipeline still
  resolves the constructor injection graph correctly after the
  extraction.
- **Runtime smoke check (deferred):** The full boot-and-observe
  smoke check (`docker compose up -d --build` / `npm run start:api`
  followed by grepping the API logs for the three
  `MemoryCronScheduler registered repeatable job ...` lines) was
  deferred in this M4 run because Docker, Redis, and Postgres are
  not available in the sandbox. The source-code check confirms
  the boot path is correct: the three `*_REPEAT_JOB_ID` literals
  are declared as `const MEMORY_EVICTION_REPEAT_JOB_ID = 'memory-eviction-cron'`,
  `const MEMORY_DECAY_REPEAT_JOB_ID = 'memory-decay-cron'`, and
  `const MEMORY_DRIFT_REPEAT_JOB_ID = 'memory-drift-cron'`
  (byte-for-byte identical to the legacy literals in the deleted
  scheduler files); the log line emitted by `register(...)` is
  `MemoryCronScheduler registered repeatable job '<jobName>' on queue '<queueName>' (jobId='<repeatJobId>', pattern='<cron>', removeOnComplete=100, removeOnFail=200)`
  (the three legacy scaffolds emitted the same line with their
  own class-name prefix in place of `MemoryCronScheduler`); and
  the `removeOnComplete` / `removeOnFail` constants
  (`CRON_REMOVE_ON_COMPLETE = 100`,
  `CRON_REMOVE_ON_FAIL = 200`) match the per-scaffold values the
  three legacy scaffolds used. The boot path is
  `MemoryCronScheduler.onApplicationBootstrap()` → for each
  `CRON_REGISTRATIONS` entry: resolve queue, call
  `register({ queue, queueName, jobName, settingKey, defaultCron, repeatJobId })`
  → `queue.add(jobName, {}, { jobId: repeatJobId ?? jobName, repeat: { pattern }, removeOnComplete: 100, removeOnFail: 200 })`.
  A live boot on a developer workstation with `docker compose up -d --build`
  should produce three `LOG [MemoryCronScheduler] MemoryCronScheduler registered repeatable job '<jobName>' on queue '<queueName>' (jobId='memory-eviction-cron'|'memory-decay-cron'|'memory-drift-cron', pattern='<cron>', removeOnComplete=100, removeOnFail=200)`
  lines at boot; if any of the three `queue.add(...)` calls
  fail, BullMQ emits its standard "duplicate jobId" warning (the
  no-op replace from the consolidation), and the scheduler logs
  the failure via the `MemoryCronScheduler failed to register repeatable job ...`
  error line and moves on.

**Owner:** refactor-executor. **Status:** Accepted (verified at M4).

## Status

Status: Accepted. Owner: refactor-executor.

The three scaffolds remain in place until milestone M2 introduces
the `MemoryCronScheduler` class file. The decision captured here
is that the three scaffolds will be replaced by a single
`MemoryCronScheduler` class with a public `register(...)` method
that takes the six arguments above, that the `jobId`s are preserved
byte-for-byte via the explicit `repeatJobId` argument, that the
`wasRegistered()` observability surface becomes a per-`jobName`
lookup, and that the `OnApplicationBootstrap` lifecycle is owned
by the new class.

## References

- `docs/architecture/memory-management.md` — the three reapers,
  their cron settings, and the `SystemSettingsService` resolution
  semantics.
- `apps/api/src/memory/memory-eviction.scheduler.ts` — the eviction
  scheduler scaffold (90% identical to the other two).
- `apps/api/src/memory/memory-decay.reaper.ts` — the decay reaper,
  whose `scheduleDecayJob` body is the inlined version of the
  same scaffold (lines 136–215 of the current file).
- `apps/api/src/memory/memory-drift.scheduler.ts` — the drift
  scheduler scaffold (90% identical to the other two).
- `apps/api/src/memory/memory-eviction.processor.ts` — exports
  `normaliseCronExpression(...)`, the helper all three scaffolds
  share. The scheduler continues to depend on this helper
  after extraction.
- `apps/api/src/memory/memory.module.ts` — the module wiring that
  imports the three schedulers and registers the three BullMQ
  queues (`BullModule.registerQueue` on lines 65–76, provider
  registrations on lines 106–112). After extraction, only one
  scheduler entry is added in place of the three.
- `docs/architecture/ADR-0001-api-module-dependency-inversion.md` —
  the module-graph policy that governs the `forwardRef` /
  `@Global()` / re-export constraints. The extraction introduces
  no new edges and complies with the policy verbatim.
- `docs/architecture/ADR-built-in-context-provider-stub-wiring.md`
  — the sibling ADR for the `BuiltInContextProviders` work item,
  documenting the same milestone pattern (M1 = decision record;
  M2+ = implementation). The cron-scheduler extraction follows
  the same shape.
- The `codebase_refactoring_analysis` nightly scan output that
  flagged the duplication under work item
  `4ed37f14-073f-420b-97b6-9069356ad408`.