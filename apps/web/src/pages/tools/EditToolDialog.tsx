import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tool } from "@/lib/api/tools.types";
import { ToolForm } from "./ToolForm";
import { ToolFormValues } from "./ToolFormValues.types";

interface EditToolDialogProps {
  open: boolean;
  tool: Tool | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onSubmit: (data: ToolFormValues) => Promise<void>;
  isSubmitting: boolean;
}

export function EditToolDialog(props: Readonly<EditToolDialogProps>) {
  const { open, tool, onOpenChange, onCancel, onSubmit, isSubmitting } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Edit Tool</DialogTitle>
        </DialogHeader>
        {tool && (
          <ToolForm
            tool={tool}
            onSubmit={onSubmit}
            onCancel={onCancel}
            isSubmitting={isSubmitting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
