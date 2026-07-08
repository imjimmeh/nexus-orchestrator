import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HarnessRunIndicatorProps {
  resolved: string;
  fallback?: {
    from: string;
    reason: string;
  };
}

function HarnessRunIndicator({
  resolved,
  fallback,
}: Readonly<HarnessRunIndicatorProps>) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="secondary">{resolved}</Badge>

      {fallback && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-help">
                fallback
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Requested: <span className="font-mono">{fallback.from}</span>
              </p>
              <p className="mt-0.5">{fallback.reason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export { HarnessRunIndicator };
export type { HarnessRunIndicatorProps };
