import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tool } from "@/lib/api/tools.types";
import { ToolSourceBadge } from "./ToolSourceBadge";
import { getToolSourceDescription } from "./tool-source";

interface ToolDetailDialogProps {
  open: boolean;
  tool: Tool | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
}

export function ToolDetailDialog(props: Readonly<ToolDetailDialogProps>) {
  const { open, tool, onOpenChange, onCancel } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>View Tool</DialogTitle>
        </DialogHeader>
        {tool && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium">Name</div>
              <div className="text-sm text-muted-foreground">{tool.name}</div>
            </div>
            <div>
              <div className="text-sm font-medium">Source</div>
              <ToolSourceBadge source={tool.source} />
            </div>
            <div>
              <div className="text-sm font-medium">Tier Restriction</div>
              <div className="text-sm text-muted-foreground">
                {tool.tier_restriction}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Schema (JSON)</div>
              <pre className="max-h-[220px] overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
                {JSON.stringify(tool.schema, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-sm font-medium">Implementation</div>
              <div className="text-sm text-muted-foreground">
                {getToolSourceDescription(tool.source)}
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
