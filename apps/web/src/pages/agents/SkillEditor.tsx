import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormReturn } from "react-hook-form";
import * as z from "zod";
import { AgentSkill } from "@/lib/api/agents.types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SkillReferenceFilesSection } from "./SkillEditor.reference-files";

const skillSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and hyphens",
    ),
  description: z.string().min(1, "Description is required").max(1024),
  compatibility: z.string().max(500).optional(),
  skill_markdown: z.string().min(1, "SKILL.md content is required"),
  is_active: z.boolean().default(true),
  scope_projects: z.string().optional(),
  scope_agents: z.string().optional(),
  scope_workflows: z.string().optional(),
});

type SkillFormData = z.infer<typeof skillSchema>;

interface SkillScope {
  projects?: string[];
  agents?: string[];
  workflows?: string[];
}

type SkillSubmitData = Omit<
  SkillFormData,
  "scope_projects" | "scope_agents" | "scope_workflows"
> & {
  scope: SkillScope | null;
};

interface SkillEditorProps {
  skill?: AgentSkill;
  onSubmit: (data: SkillSubmitData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

interface SkillEditorFormBodyProps {
  form: UseFormReturn<SkillFormData>;
  onSubmit: (data: SkillSubmitData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
  skillId: string;
}

interface SkillEditorActionRowProps {
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}

function buildSkillTemplate(skill?: AgentSkill): string {
  if (skill?.skill_markdown) {
    return skill.skill_markdown;
  }

  const name = skill?.name ?? "example-skill";
  const description =
    skill?.description ?? "Describe what this skill helps with";

  return `---
name: ${name}
description: ${description}
---

# Goal

Summarize what this skill does.

# Instructions

1. Add concrete guidance.
2. Keep steps deterministic.
`;
}

function joinScopeIds(ids: string[] | undefined): string {
  return ids?.join(", ") ?? "";
}

function resolveSkillName(skill?: AgentSkill): string {
  return skill?.name ?? "";
}

function resolveSkillDescription(skill?: AgentSkill): string {
  return skill?.description ?? "";
}

function resolveSkillCompatibility(skill?: AgentSkill): string {
  return skill?.compatibility ?? "";
}

function resolveSkillActive(skill?: AgentSkill): boolean {
  return skill?.is_active ?? true;
}

function getSkillDefaults(skill?: AgentSkill): SkillFormData {
  return {
    name: resolveSkillName(skill),
    description: resolveSkillDescription(skill),
    compatibility: resolveSkillCompatibility(skill),
    skill_markdown: buildSkillTemplate(skill),
    is_active: resolveSkillActive(skill),
    scope_projects: joinScopeIds(skill?.scope?.projects),
    scope_agents: joinScopeIds(skill?.scope?.agents),
    scope_workflows: joinScopeIds(skill?.scope?.workflows),
  };
}

function getSubmitLabel(isSubmitting: boolean, skill?: AgentSkill): string {
  if (isSubmitting) {
    return "Saving...";
  }

  return skill ? "Update" : "Create";
}

function SkillEditorNameAndCompatibilityFields({
  form,
}: Readonly<Pick<SkillEditorFormBodyProps, "form">>) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input placeholder="review-plan" {...field} />
            </FormControl>
            <FormDescription>
              Must match frontmatter name in SKILL.md.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="compatibility"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Compatibility</FormLabel>
            <FormControl>
              <Input
                placeholder="pi-runner>=1.0"
                value={field.value ?? ""}
                onChange={field.onChange}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function SkillEditorDescriptionField({
  form,
}: Readonly<Pick<SkillEditorFormBodyProps, "form">>) {
  return (
    <FormField
      control={form.control}
      name="description"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Description</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Short description shown in skill catalog"
              className="min-h-[80px]"
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SkillEditorMarkdownField({
  form,
}: Readonly<Pick<SkillEditorFormBodyProps, "form">>) {
  return (
    <FormField
      control={form.control}
      name="skill_markdown"
      render={({ field }) => (
        <FormItem>
          <FormLabel>SKILL.md Content</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Paste full SKILL.md, including YAML frontmatter"
              className="min-h-[280px] font-mono text-xs"
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SkillReferenceFilesCard({ skillId }: Readonly<{ skillId: string }>) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <FormLabel>Reference Files</FormLabel>
        <FormDescription>
          Store additional files that SKILL.md can reference, such as
          references/REFERENCE.md or scripts/run.sh.
        </FormDescription>
      </div>

      <SkillReferenceFilesSection skillId={skillId} />
    </div>
  );
}

function SkillEditorActiveField({
  form,
}: Readonly<Pick<SkillEditorFormBodyProps, "form">>) {
  return (
    <FormField
      control={form.control}
      name="is_active"
      render={({ field }) => (
        <FormItem className="flex flex-row items-center gap-3 rounded-md border p-3">
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => {
                field.onChange(Boolean(checked));
              }}
            />
          </FormControl>
          <div>
            <FormLabel>Active</FormLabel>
            <FormDescription>
              Inactive skills cannot be assigned to profiles.
            </FormDescription>
          </div>
        </FormItem>
      )}
    />
  );
}

function SkillEditorScopeFields({
  form,
}: Readonly<Pick<SkillEditorFormBodyProps, "form">>) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Scope (optional)</p>
      <p className="text-xs text-muted-foreground">
        Leave blank for global availability. Comma-separated IDs to restrict
        binding.
      </p>
      <FormField
        control={form.control}
        name="scope_projects"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Projects</FormLabel>
            <FormControl>
              <Input
                placeholder="proj-abc, proj-xyz"
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="scope_agents"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Agent Profiles</FormLabel>
            <FormControl>
              <Input
                placeholder="skill-author, orchestrator"
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="scope_workflows"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Workflow IDs</FormLabel>
            <FormControl>
              <Input
                placeholder="create_skill"
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function SkillEditorActionRow({
  onCancel,
  isSubmitting,
  submitLabel,
}: Readonly<SkillEditorActionRowProps>) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </div>
  );
}

function parseIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function buildScope(
  projects: string[],
  agents: string[],
  workflows: string[],
): SkillScope | null {
  if (!projects.length && !agents.length && !workflows.length) {
    return null;
  }
  return {
    ...(projects.length ? { projects } : {}),
    ...(agents.length ? { agents } : {}),
    ...(workflows.length ? { workflows } : {}),
  };
}

function SkillEditorFormBody({
  form,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
  skillId,
}: Readonly<SkillEditorFormBodyProps>) {
  function handleValidSubmit(values: SkillFormData): void {
    const { scope_projects, scope_agents, scope_workflows, ...rest } = values;
    const scope = buildScope(
      parseIds(scope_projects),
      parseIds(scope_agents),
      parseIds(scope_workflows),
    );
    onSubmit({ ...rest, scope });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void form.handleSubmit(handleValidSubmit)(event);
        }}
        className="space-y-4"
      >
        <SkillEditorNameAndCompatibilityFields form={form} />
        <SkillEditorDescriptionField form={form} />
        <SkillEditorMarkdownField form={form} />
        <SkillReferenceFilesCard skillId={skillId} />
        <SkillEditorActiveField form={form} />
        <SkillEditorScopeFields form={form} />
        <SkillEditorActionRow
          onCancel={onCancel}
          isSubmitting={isSubmitting}
          submitLabel={submitLabel}
        />
      </form>
    </Form>
  );
}

export function SkillEditor({
  skill,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<SkillEditorProps>) {
  const form = useForm<SkillFormData>({
    resolver: zodResolver(skillSchema as never),
    defaultValues: getSkillDefaults(skill),
  });

  useEffect(() => {
    form.reset(getSkillDefaults(skill));
  }, [form, skill]);

  const skillId = skill?.id ?? "";
  const submitLabel = getSubmitLabel(isSubmitting, skill);

  return (
    <SkillEditorFormBody
      form={form}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isSubmitting={isSubmitting}
      submitLabel={submitLabel}
      skillId={skillId}
    />
  );
}
