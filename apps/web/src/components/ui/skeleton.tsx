import { cn } from "@/lib/utils";

export function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-8 shadow">
      <Skeleton className="mb-4 h-6 w-40" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((entry) => (
        <div key={entry} className="rounded-xl border bg-card p-6">
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="mb-4 h-9 w-16" />
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  );
}
