import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  onCtaClick,
}: Readonly<EmptyStateProps>) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
      <Icon className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="mb-2 text-lg font-semibold">{title}</p>
      <p className="mb-4 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {ctaLabel && ctaHref ? (
        <Button asChild>
          <Link to={ctaHref}>{ctaLabel}</Link>
        </Button>
      ) : null}
      {ctaLabel && !ctaHref && onCtaClick ? (
        <Button onClick={onCtaClick}>{ctaLabel}</Button>
      ) : null}
    </div>
  );
}
