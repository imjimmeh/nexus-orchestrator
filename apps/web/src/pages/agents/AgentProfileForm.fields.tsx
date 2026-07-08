import { useState } from "react";
import { type UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgentSkill } from "@/lib/api/agents.types";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { Tool } from "@/lib/api/tools.types";
import { HarnessAssetEditor } from "./HarnessAssetEditor";
import type { HarnessContributionsValue } from "./HarnessAssetEditor.types";

function nextSelectedIds(
  selectedIds: string[],
  id: string,
  nextChecked: boolean,
): string[] {
  if (nextChecked) {
    return selectedIds.includes(id) ? selectedIds : [...selectedIds, id];
  }

  return selectedIds.filter((existing) => existing !== id);
}

export function ProviderAndModelFields(
  props: Readonly<{
    form: UseFormReturn<any>;
    providers: LLMProvider[];
    filteredModels: LLMModel[];
    handleProviderChange: (value: string) => void;
    noneOptionValue: string;
  }>,
) {
  const {
    form,
    providers,
    filteredModels,
    handleProviderChange,
    noneOptionValue,
  } = props;

  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        control={form.control}
        name="provider_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Provider</FormLabel>
            <Select
              onValueChange={handleProviderChange}
              value={field.value || noneOptionValue}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={noneOptionValue}>None</SelectItem>
                {providers.length === 0 ? (
                  <SelectItem value="no-providers" disabled>
                    No providers available
                  </SelectItem>
                ) : (
                  providers.map((provider: LLMProvider) => (
                    <SelectItem key={provider.id} value={provider.name}>
                      {provider.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="model_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Model</FormLabel>
            <Select
              onValueChange={(value) =>
                field.onChange(value === noneOptionValue ? "" : value)
              }
              value={field.value || noneOptionValue}
              disabled={filteredModels.length === 0}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      filteredModels.length === 0
                        ? "Select provider first"
                        : "Select a model"
                    }
                  />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={noneOptionValue}>None</SelectItem>
                {filteredModels.length === 0 ? (
                  <SelectItem value="no-models" disabled>
                    No models available
                  </SelectItem>
                ) : (
                  filteredModels.map((model: LLMModel) => (
                    <SelectItem key={model.id} value={model.name}>
                      {model.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

type ToolPermission = "none" | "allowed" | "denied" | "approval";

interface PermissionRadioProps {
  toolName: string;
  value: ToolPermission;
  onChange: (next: ToolPermission) => void;
}

function PermissionRadio({
  toolName,
  value,
  onChange,
}: Readonly<PermissionRadioProps>) {
  const options: { id: ToolPermission; label: string }[] = [
    { id: "none", label: "None" },
    { id: "allowed", label: "Allowed" },
    { id: "denied", label: "Denied" },
    { id: "approval", label: "Req. Approval" },
  ];

  return (
    <div className="flex items-center gap-4">
      {options.map((opt) => (
        <label
          key={opt.id}
          className="flex cursor-pointer items-center gap-1.5 text-sm"
        >
          <input
            type="radio"
            name={`tool-perm-${toolName}`}
            value={opt.id}
            checked={value === opt.id}
            onChange={() => onChange(opt.id)}
            className="accent-primary"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export function ToolPermissionsTable(
  props: Readonly<{
    form: UseFormReturn<any>;
    tools: Tool[];
  }>,
) {
  const { form, tools } = props;
  const [search, setSearch] = useState("");

  const allowedTools: string[] = form.watch("allowed_tools") ?? [];
  const deniedTools: string[] = form.watch("denied_tools") ?? [];
  const approvalTools: string[] = form.watch("approval_required_tools") ?? [];

  function getPermission(toolName: string): ToolPermission {
    if (allowedTools.includes(toolName)) return "allowed";
    if (deniedTools.includes(toolName)) return "denied";
    if (approvalTools.includes(toolName)) return "approval";
    return "none";
  }

  function setPermission(toolName: string, next: ToolPermission) {
    const removeFrom = (arr: string[]) => arr.filter((n) => n !== toolName);
    form.setValue("allowed_tools", removeFrom(allowedTools), {
      shouldValidate: true,
    });
    form.setValue("denied_tools", removeFrom(deniedTools), {
      shouldValidate: true,
    });
    form.setValue("approval_required_tools", removeFrom(approvalTools), {
      shouldValidate: true,
    });

    if (next === "allowed") {
      form.setValue("allowed_tools", [...removeFrom(allowedTools), toolName], {
        shouldValidate: true,
      });
    } else if (next === "denied") {
      form.setValue("denied_tools", [...removeFrom(deniedTools), toolName], {
        shouldValidate: true,
      });
    } else if (next === "approval") {
      form.setValue(
        "approval_required_tools",
        [...removeFrom(approvalTools), toolName],
        { shouldValidate: true },
      );
    }
  }

  const filtered = search
    ? tools.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : tools;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <FormLabel>Tool Permissions</FormLabel>
        <Input
          placeholder="Search tools..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 w-48 text-sm"
        />
      </div>
      <div className="max-h-[320px] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Permission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-muted-foreground"
                >
                  {tools.length === 0
                    ? "No tools available."
                    : "No tools match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((tool) => (
                <TableRow key={tool.id}>
                  <TableCell className="font-medium">{tool.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        tool.tier_restriction === 2 ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {tool.tier_restriction === 2 ? "heavy" : "light"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PermissionRadio
                      toolName={tool.name}
                      value={getPermission(tool.name)}
                      onChange={(next) => setPermission(tool.name, next)}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {/* Surface validation error from allowed_tools field (cross-field rule) */}
      <FormField
        control={form.control}
        name="allowed_tools"
        render={() => <FormMessage />}
      />
    </div>
  );
}

export function AssignedSkillsField(
  props: Readonly<{
    form: UseFormReturn<any>;
    skills: AgentSkill[];
  }>,
) {
  const { form, skills } = props;

  return (
    <FormField
      control={form.control}
      name="skill_ids"
      render={({ field }) => {
        const selectedIds: string[] = field.value ?? [];

        return (
          <FormItem>
            <FormLabel>Assigned Skills</FormLabel>
            <FormControl>
              <div className="max-h-[180px] space-y-2 overflow-auto rounded-md border p-3">
                {skills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active skills available.
                  </p>
                ) : (
                  skills.map((skill) => {
                    const checked = selectedIds.includes(skill.id);
                    return (
                      <label
                        key={skill.id}
                        className="flex cursor-pointer items-start gap-3 rounded-sm p-1 hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            field.onChange(
                              nextSelectedIds(
                                selectedIds,
                                skill.id,
                                Boolean(nextChecked),
                              ),
                            );
                          }}
                        />
                        <span className="text-sm">
                          <span className="font-medium">{skill.name}</span>
                          <span className="ml-2 text-muted-foreground">
                            {skill.description}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

export function HarnessContributionsField({
  value,
  onChange,
}: Readonly<{
  value: HarnessContributionsValue;
  onChange: (next: HarnessContributionsValue) => void;
}>) {
  return (
    <section className="space-y-2">
      <label className="text-sm font-medium">Harness Contributions</label>
      <p className="text-sm text-muted-foreground">
        Author hooks, extensions, and attach existing plugin / extension assets
        by id. Applied per the resolved harness's capabilities; unsupported
        entries are dropped. Hook commands run in the container at your
        authorship trust level.
      </p>
      <HarnessAssetEditor value={value} onChange={onChange} />
    </section>
  );
}
