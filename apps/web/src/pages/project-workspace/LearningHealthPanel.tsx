import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  MemoryMetricsLearningBehaviourChange,
  MemoryMetricsLearningConvergenceSnapshot,
  MemoryMetricsLearningLiftSnapshot,
  MemoryMetricsLearningMetrics,
  MemoryMetricsLearningProbation,
} from "@/lib/api/memory.types";
import { formatLearningPercent } from "./LearningTab.helpers";

const PANEL_DESCRIPTION =
  "Convergence, behaviour-change, holdout lift, cost, suppressed-noise, and probation for the learning loop.";

const HOLDOUT_DISABLED_EMPTY_STATE = "Enable holdout to measure";
const NO_SPEND_DATA_EMPTY_STATE = "No spend data";
const NOT_AVAILABLE = "Not available";

interface LearningHealthPanelProps {
  readonly learning: MemoryMetricsLearningMetrics | undefined;
  /** Forwarded from `useMemoryMetrics().isLoading` for background refetches. */
  readonly isLoading?: boolean;
}

interface HealthTileProps {
  readonly label: string;
  readonly value: string;
}

function HealthTile({ label, value }: Readonly<HealthTileProps>) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

interface HealthSectionProps {
  readonly title: string;
  readonly children: ReactNode;
}

function HealthSection({ title, children }: Readonly<HealthSectionProps>) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function formatLiftValue(value: number): string {
  return value.toFixed(2);
}

function formatCostCents(value: number): string {
  return `${value.toFixed(2)}¢`;
}

export function LearningHealthPanel({
  learning,
  isLoading,
}: Readonly<LearningHealthPanelProps>) {
  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-2 pb-4">
        <CardTitle className="text-base">Learning Health</CardTitle>
        <p className="text-sm text-muted-foreground">{PANEL_DESCRIPTION}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && !learning ? (
          <p className="text-sm text-muted-foreground">
            Loading learning metrics…
          </p>
        ) : null}
        <ConvergenceSection convergence={learning?.convergence} />
        <BehaviourChangeSection behaviourChange={learning?.behaviour_change} />
        <HoldoutLiftSection lift={learning?.lift} />
        <CostSection cost={learning?.cost_per_promoted_memory} />
        <SuppressedNoiseSection count={learning?.suppressed_noise_count} />
        <ProbationSection probation={learning?.probation} />
      </CardContent>
    </Card>
  );
}

function ConvergenceSection({
  convergence,
}: {
  readonly convergence:
    | Record<string, MemoryMetricsLearningConvergenceSnapshot>
    | undefined;
}) {
  const entries = Object.entries(convergence ?? {});

  return (
    <HealthSection title="Convergence">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No convergence data yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map(([scope, snapshot]) => (
            <div
              key={scope}
              className="space-y-1 rounded-md border bg-background p-3 text-sm"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {scope}
              </p>
              <p className="text-base font-semibold">
                {snapshot.ratio.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">
                {snapshot.successes_after_lesson.toString()} /{" "}
                {snapshot.runs_after_lesson.toString()} runs
              </p>
            </div>
          ))}
        </div>
      )}
    </HealthSection>
  );
}

function BehaviourChangeSection({
  behaviourChange,
}: {
  readonly behaviourChange: MemoryMetricsLearningBehaviourChange | undefined;
}) {
  const changed = behaviourChange?.changed_total ?? 0;
  const unchanged = behaviourChange?.unchanged_total ?? 0;
  const observations = changed + unchanged;

  return (
    <HealthSection title="Behaviour change">
      {observations === 0 ? (
        <p className="text-sm text-muted-foreground">No observations yet.</p>
      ) : (
        <div className="space-y-1 rounded-md border bg-background p-3 text-sm">
          <p className="text-base font-semibold">
            {formatLearningPercent(changed / observations)}
          </p>
          <p className="text-xs text-muted-foreground">
            {changed.toString()} / {observations.toString()} injected lessons
            exercised their anchor
          </p>
        </div>
      )}
    </HealthSection>
  );
}

function HoldoutLiftSection({
  lift,
}: {
  readonly lift: Record<string, MemoryMetricsLearningLiftSnapshot> | undefined;
}) {
  const entries = Object.entries(lift ?? {});

  return (
    <HealthSection title="Holdout lift">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {HOLDOUT_DISABLED_EMPTY_STATE}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map(([scope, snapshot]) => (
            <HoldoutLiftRow key={scope} scope={scope} snapshot={snapshot} />
          ))}
        </div>
      )}
    </HealthSection>
  );
}

function HoldoutLiftRow({
  scope,
  snapshot,
}: {
  readonly scope: string;
  readonly snapshot: MemoryMetricsLearningLiftSnapshot;
}) {
  return (
    <div className="space-y-1 rounded-md border bg-background p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {scope}
      </p>
      {snapshot.lift === null ? (
        <p className="text-sm text-muted-foreground">
          {HOLDOUT_DISABLED_EMPTY_STATE}
        </p>
      ) : (
        <>
          <p className="text-base font-semibold">
            {formatLiftValue(snapshot.lift)}
          </p>
          <p className="text-xs text-muted-foreground">
            injected {snapshot.injected.ratio.toFixed(2)} · holdout{" "}
            {snapshot.holdout.ratio.toFixed(2)}
          </p>
        </>
      )}
    </div>
  );
}

function CostSection({ cost }: { readonly cost: number | null | undefined }) {
  return (
    <HealthSection title="Cost per promoted memory">
      {cost === null || cost === undefined ? (
        <p className="text-sm text-muted-foreground">
          {NO_SPEND_DATA_EMPTY_STATE}
        </p>
      ) : (
        <HealthTile label="Cents per memory" value={formatCostCents(cost)} />
      )}
    </HealthSection>
  );
}

function SuppressedNoiseSection({
  count,
}: {
  readonly count: number | null | undefined;
}) {
  return (
    <HealthSection title="Suppressed noise">
      <HealthTile
        label="Candidates merged away"
        value={
          count === null || count === undefined
            ? NOT_AVAILABLE
            : count.toString()
        }
      />
    </HealthSection>
  );
}

function ProbationSection({
  probation,
}: {
  readonly probation: MemoryMetricsLearningProbation | undefined;
}) {
  return (
    <HealthSection title="Probation">
      <div className="grid gap-3 sm:grid-cols-3">
        <HealthTile
          label="Confirmed"
          value={(probation?.confirmed_total ?? 0).toString()}
        />
        <HealthTile
          label="Reverted"
          value={(probation?.reverted_total ?? 0).toString()}
        />
        <HealthTile
          label="Held"
          value={(probation?.held_total ?? 0).toString()}
        />
      </div>
    </HealthSection>
  );
}
