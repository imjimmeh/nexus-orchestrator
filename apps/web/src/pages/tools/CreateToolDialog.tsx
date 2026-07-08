import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { ToolForm } from "./ToolForm";
import { ToolFormValues } from "./ToolFormValues.types";

interface CreateToolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ToolFormValues) => Promise<void>;
  isSubmitting: boolean;
}

export function CreateToolDialog(
  props: Readonly<CreateToolDialogProps>,
) {
  const { open, onOpenChange, onSubmit, isSubmitting } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Tool
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Create Tool</DialogTitle>
        </DialogHeader>
        <ToolForm
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
