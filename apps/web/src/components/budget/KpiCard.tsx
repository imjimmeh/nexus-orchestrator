type KpiCardProps = {
  title: string;
  value: string;
  description?: string;
  isLoading?: boolean;
};

export function KpiCard({
  title,
  value,
  description,
  isLoading,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-8 w-32 animate-pulse rounded bg-muted" />
        {description ? (
          <div className="mt-1 h-3 w-40 animate-pulse rounded bg-muted" />
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {description ? (
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      ) : null}
    </div>
  );
}
