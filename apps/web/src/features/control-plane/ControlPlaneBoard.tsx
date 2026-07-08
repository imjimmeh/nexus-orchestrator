import type {
  ControlPlaneBoardFact,
  ControlPlaneBoardIntent,
  ControlPlaneBoardResponse,
} from "./controlPlane.types";
import { MemoryHealthCard } from "./MemoryHealthCard";
import { PromotedLessonsCard } from "./PromotedLessonsCard";
import { SkillBindingUsageCard } from "./SkillBindingUsageCard";
import { useMemoryMetrics } from "@/hooks/useMemoryMetrics";
import { usePromotedLessons } from "@/hooks/usePromotedLessons";

interface ControlPlaneBoardProps {
  readonly board: ControlPlaneBoardResponse;
}

export function ControlPlaneBoard({ board }: ControlPlaneBoardProps) {
  const { data: metricsData, isLoading: metricsLoading } = useMemoryMetrics({
    refetchInterval: 30_000,
  });
  const { data: promotedData, isLoading: promotedLoading } = usePromotedLessons({
    refetchInterval: 30_000,
  });

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Control Plane</h2>
        <p className="text-sm text-muted-foreground">
          Generated {board.generatedAt}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {board.lanes.map((lane) => (
          <article
            key={lane.lane}
            className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium">{formatLaneName(lane.lane)}</h3>
              <span className="text-right text-xs text-muted-foreground">
                {lane.activeCount} active · {lane.pendingCount} pending ·{" "}
                {lane.blockedCount} blocked
              </span>
            </div>
            {lane.intents.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {lane.intents.map((intent) => (
                  <IntentCard key={intent.id} intent={intent} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No intents in this lane.
              </p>
            )}
          </article>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title={`Facts: ${board.facts.length}`}
          items={board.facts}
        />
        <OutcomeSummary board={board} />
        <StaleLinksSummary board={board} />
      </div>

      <div className="grid gap-4 md:grid-cols-1">
        <MemoryHealthCard snapshot={metricsData} isLoading={metricsLoading} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PromotedLessonsCard
          snapshot={promotedData}
          isLoading={promotedLoading}
        />
        <SkillBindingUsageCard
          snapshot={promotedData?.bindings}
          isLoading={promotedLoading}
        />
      </div>
    </section>
  );
}

function IntentCard({ intent }: { readonly intent: ControlPlaneBoardIntent }) {
  return (
    <li className="rounded-md border bg-background p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <strong className="font-medium">{intent.type}</strong>
        <span className="text-xs text-muted-foreground">
          Status: {intent.status} · Priority: {intent.priority}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">{intent.reason}</p>
      {intent.latestOutcome ? (
        <p className="mt-2 text-xs text-amber-700">
          Latest decision: {intent.latestOutcome.reason}
        </p>
      ) : null}
      {intent.launchAttempts.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Launch attempts: {intent.launchAttempts.length}
        </p>
      ) : null}
    </li>
  );
}

function SummaryCard({
  title,
  items,
}: {
  readonly title: string;
  readonly items: ControlPlaneBoardFact[];
}) {
  return (
    <article className="rounded-lg border bg-card p-4 text-sm shadow-sm">
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {items.slice(0, 5).map((item) => (
          <li key={item.id}>{item.type}</li>
        ))}
      </ul>
    </article>
  );
}

function OutcomeSummary({
  board,
}: {
  readonly board: ControlPlaneBoardResponse;
}) {
  return (
    <article className="rounded-lg border bg-card p-4 text-sm shadow-sm">
      <h3 className="font-medium">
        No-launch reasons: {board.noLaunchReasons.length}
      </h3>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {board.noLaunchReasons.slice(0, 5).map((outcome) => (
          <li key={outcome.id}>{outcome.reason}</li>
        ))}
      </ul>
    </article>
  );
}

function StaleLinksSummary({
  board,
}: {
  readonly board: ControlPlaneBoardResponse;
}) {
  return (
    <article className="rounded-lg border bg-card p-4 text-sm shadow-sm">
      <h3 className="font-medium">Stale links: {board.staleLinks.length}</h3>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {board.staleLinks.slice(0, 5).map((fact) => (
          <li key={fact.id}>{fact.subjectId}</li>
        ))}
      </ul>
    </article>
  );
}

function formatLaneName(lane: string): string {
  return lane.replace(/_/g, " ");
}
