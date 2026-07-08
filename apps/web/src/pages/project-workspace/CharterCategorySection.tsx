import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CharterMemoryItem } from "@/lib/api/client.projects";

interface CharterCategorySectionProps {
  readonly label: string;
  readonly category: string;
  readonly items: CharterMemoryItem[];
  readonly onAdd: (content: string) => void;
  readonly onUpdate: (memoryId: string, content: string) => void;
  readonly onDelete: (memoryId: string) => void;
}

export function CharterCategorySection({
  label,
  category,
  items,
  onAdd,
  onUpdate,
  onDelete,
}: Readonly<CharterCategorySectionProps>) {
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [newContent, setNewContent] = useState("");

  const startEdit = (item: CharterMemoryItem) => {
    setEditingId(item.id);
    setEditContent(item.content);
  };

  const commitEdit = () => {
    if (editingId && editContent.trim()) {
      onUpdate(editingId, editContent.trim());
    }
    setEditingId(null);
    setEditContent("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const commitAdd = () => {
    if (newContent.trim()) {
      onAdd(newContent.trim());
    }
    setAdding(false);
    setNewContent("");
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewContent("");
  };

  return (
    <div className="border rounded-md">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{items.length}</span>
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2">
          {items.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground py-1">None yet</p>
          )}

          {items.map((item) =>
            editingId === item.id ? (
              <div key={item.id} className="flex gap-2 items-start">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="text-sm min-h-[60px] flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      commitEdit();
                    }
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
                <div className="flex flex-col gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={commitEdit}
                    aria-label="Save"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={cancelEdit}
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={item.id}
                className="flex items-start justify-between group gap-2"
              >
                <p
                  className="text-sm flex-1 cursor-pointer hover:text-foreground text-muted-foreground"
                  onClick={() => startEdit(item)}
                >
                  {item.content}
                </p>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => startEdit(item)}
                    aria-label={`Edit ${category} item`}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => onDelete(item.id)}
                    aria-label={`Delete ${category} item`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ),
          )}

          {adding ? (
            <div className="flex gap-2 items-start">
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={`Add a ${label.toLowerCase()} item…`}
                className="text-sm min-h-[60px] flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commitAdd();
                  }
                  if (e.key === "Escape") cancelAdd();
                }}
              />
              <div className="flex flex-col gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={commitAdd}
                  aria-label="Save new item"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={cancelAdd}
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground text-xs h-7"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add item
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
