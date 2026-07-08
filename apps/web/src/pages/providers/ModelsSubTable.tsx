import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2 } from "lucide-react";
import { LLMModel } from "@/lib/api/models.types";

interface ModelsSubTableProps {
  models: LLMModel[];
  onEditModel: (model: LLMModel) => void;
  onDeleteModel: (model: LLMModel) => void;
  showProviderName?: boolean;
}

export function ModelsSubTable({
  models,
  onEditModel,
  onDeleteModel,
  showProviderName = false,
}: Readonly<ModelsSubTableProps>) {
  return (
    <div className="rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model Name</TableHead>
            {showProviderName && <TableHead>Provider Reference</TableHead>}
            <TableHead>Token Limit</TableHead>
            <TableHead>Default For</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((model) => {
            const defaultBadges: string[] = [];
            if (model.default_for_execution) defaultBadges.push("Execution");
            if (model.default_for_distillation)
              defaultBadges.push("Distillation");
            if (model.default_for_summarization)
              defaultBadges.push("Summarization");
            if (model.default_for_session) defaultBadges.push("Session");
            if (model.default_for_embedding) defaultBadges.push("Embedding");

            return (
              <TableRow key={model.id}>
                <TableCell className="font-medium">{model.name}</TableCell>
                {showProviderName && (
                  <TableCell className="text-muted-foreground italic">
                    {model.provider_name || "(None)"}
                  </TableCell>
                )}
                <TableCell>{model.token_limit.toLocaleString()}</TableCell>
                <TableCell>
                  {defaultBadges.length === 0 ? (
                    "-"
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {defaultBadges.map((b) => (
                        <Badge
                          key={b}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {b}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={model.is_active ? "default" : "secondary"}>
                    {model.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditModel(model)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteModel(model)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
