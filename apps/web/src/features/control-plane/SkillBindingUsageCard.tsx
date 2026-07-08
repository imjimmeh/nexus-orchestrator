import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  SkillBindingUsage,
  SkillBindingMostSpecificSource,
} from "@/lib/api/self-improvement.types";

interface SkillBindingUsageCardProps {
  readonly snapshot: SkillBindingUsage[] | undefined;
  /**
   * Forwarded from `usePromotedLessons().isLoading` so the card
   * renders the loading placeholder on background refetches
   * when the previous snapshot is still cached.
   */
  readonly isLoading?: boolean;
}

const CARD_DESCRIPTION =
  "Currently-active workflow skill bindings, the binding-scope (step or workflow), and the reuse count in the trailing window.";

const EMPTY_MESSAGE = "No active skill bindings";

const SOURCE_LABEL: Record<SkillBindingMostSpecificSource, string> = {
  step: "step",
  workflow: "workflow",
};

export function SkillBindingUsageCard({
  snapshot,
  isLoading,
}: Readonly<SkillBindingUsageCardProps>) {
  if (!snapshot) {
    return <SkillBindingUsageCardLoading />;
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-2 pb-4">
        <CardTitle className="text-base">Skill Binding Usage</CardTitle>
        <p className="text-sm text-muted-foreground">{CARD_DESCRIPTION}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : snapshot.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY_MESSAGE}</p>
        ) : (
          <ul className="space-y-2">
            {snapshot.map((binding) => (
              <SkillBindingRow key={binding.id} binding={binding} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SkillBindingUsageCardLoading() {
  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-2 pb-4">
        <CardTitle className="text-base">Skill Binding Usage</CardTitle>
        <p className="text-sm text-muted-foreground">{CARD_DESCRIPTION}</p>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </CardContent>
    </Card>
  );
}

function SkillBindingRow({
  binding,
}: {
  readonly binding: SkillBindingUsage;
}) {
  const stepId = binding.workflowStepIds[0] ?? null;
  return (
    <li className="rounded-md border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-xs">{binding.id}</code>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{SOURCE_LABEL[binding.mostSpecificSource]}</Badge>
          <ReuseBadge reuseCount7d={binding.reuseCount7d} />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {stepId !== null
          ? `step_id: ${stepId}`
          : "workflow-scoped (no step_id)"}
      </p>
    </li>
  );
}

function ReuseBadge({ reuseCount7d }: { readonly reuseCount7d: number }) {
  if (reuseCount7d > 0) {
    return (
      <Badge variant="success">
        reuse {reuseCount7d.toString()} / 7d
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">reuse 0 / 7d (never referenced)</Badge>
  );
}
