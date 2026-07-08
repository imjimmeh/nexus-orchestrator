import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  PromotedLesson,
  PromotedLessonsResponse,
} from "@/lib/api/self-improvement.types";

interface PromotedLessonsCardProps {
  readonly snapshot: PromotedLessonsResponse | undefined;
  /**
   * Forwarded from `usePromotedLessons().isLoading` so the card
   * renders the loading placeholder on background refetches
   * when the previous snapshot is still cached.
   *
   * The card-level "Loading…" placeholder still fires when
   * `snapshot` is `undefined` (initial fetch), so this flag is
   * only consulted as a secondary signal.
   */
  readonly isLoading?: boolean;
}

const CARD_DESCRIPTION =
  "Recent promoted learning candidates and the runtime-feedback signal group that drove each promotion, when one was correlated.";

const EMPTY_MESSAGE = "No promoted lessons in last 7 days";

const CONFIDENCE_VARIANTS = {
  high: "success",
  medium: "outline",
  low: "destructive",
} as const;

function confidenceVariant(confidence: number): "success" | "outline" | "destructive" {
  if (confidence >= 0.8) {
    return CONFIDENCE_VARIANTS.high;
  }
  if (confidence >= 0.5) {
    return CONFIDENCE_VARIANTS.medium;
  }
  return CONFIDENCE_VARIANTS.low;
}

function buildSignalDiagnosticsHref(signalGroupId: string): string {
  const params = new URLSearchParams({ signalGroupId });
  return `/runtime-feedback/diagnostics?${params.toString()}`;
}

export function PromotedLessonsCard({
  snapshot,
  isLoading,
}: Readonly<PromotedLessonsCardProps>) {
  if (!snapshot) {
    return <PromotedLessonsCardLoading />;
  }

  const promoted = snapshot.promoted;

  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-2 pb-4">
        <CardTitle className="text-base">Promoted Lessons</CardTitle>
        <p className="text-sm text-muted-foreground">{CARD_DESCRIPTION}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : promoted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY_MESSAGE}</p>
        ) : (
          <ul className="space-y-2">
            {promoted.map((lesson) => (
              <PromotedLessonRow key={lesson.id} lesson={lesson} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PromotedLessonsCardLoading() {
  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-2 pb-4">
        <CardTitle className="text-base">Promoted Lessons</CardTitle>
        <p className="text-sm text-muted-foreground">{CARD_DESCRIPTION}</p>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </CardContent>
    </Card>
  );
}

function PromotedLessonRow({
  lesson,
}: {
  readonly lesson: PromotedLesson;
}) {
  return (
    <li className="rounded-md border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-xs">{lesson.id}</code>
        <Badge variant={confidenceVariant(lesson.confidence)}>
          confidence {lesson.confidence.toFixed(2)}
        </Badge>
      </div>
      <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        <DefinitionRow label="Promoted at" value={lesson.promotedAt} />
        <DefinitionRow
          label="Source signal"
          value={renderSourceSignal(lesson.sourceSignalId)}
        />
        <DefinitionRow
          label="Workflow bindings"
          value={
            lesson.workflowSkillBindingIds.length === 0
              ? "none"
              : lesson.workflowSkillBindingIds.join(", ")
          }
        />
      </dl>
    </li>
  );
}

function renderSourceSignal(sourceSignalId: string | null) {
  if (sourceSignalId === null) {
    return <span className="text-muted-foreground">uncorrelated</span>;
  }
  return (
    <Link
      to={buildSignalDiagnosticsHref(sourceSignalId)}
      className="text-primary underline-offset-2 hover:underline"
    >
      {sourceSignalId}
    </Link>
  );
}

function DefinitionRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
