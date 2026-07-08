import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface QuickCreateWorkItemProps {
  isPending: boolean;
  onSubmit: (title: string) => void;
}

export function QuickCreateWorkItem({
  isPending,
  onSubmit,
}: Readonly<QuickCreateWorkItemProps>) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const expand = () => {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const collapse = () => {
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const trimmed = e.currentTarget.value.trim();
      if (trimmed.length > 0) {
        onSubmit(trimmed);
      }
      collapse();
    } else if (e.key === "Escape") {
      collapse();
    }
  };

  const handleBlur = () => {
    if (!inputRef.current || inputRef.current.value.trim().length === 0) {
      collapse();
    }
  };

  if (!expanded) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start border border-dashed text-muted-foreground"
        onClick={expand}
      >
        <Plus className="mr-1 h-4 w-4" />+ Add item
      </Button>
    );
  }

  return (
    <Input
      ref={inputRef}
      placeholder="What needs to be done?"
      disabled={isPending}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  );
}
