import { useEffect, useMemo } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { THINKING_LEVEL_ORDER } from "@nexus/core";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AgentProfile, AgentSkill } from "@/lib/api/agents.types";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { Tool } from "@/lib/api/tools.types";
import {
  AssignedSkillsField,
  HarnessContributionsField,
  ProviderAndModelFields,
  ToolPermissionsTable,
} from "./AgentProfileForm.fields";
import { AgentProfileEditorTabs } from "./AgentProfileEditor.tabs";
import { INHERIT_THINKING_LEVEL } from "@/lib/thinking-level";
import { FallbackChainEditor } from "@/components/fallback/FallbackChainEditor";
import { RuntimeToolchainEditor } from "@/components/runtime-toolchains/RuntimeToolchainEditor";
import { AgentProfileProvenance } from "./AgentProfileForm.provenance";
import { buildCategorizedToolLists } from "./AgentProfileForm.tool-categorization";

const NONE_OPTION_VALUE = "__none__";

const fallbackChainEntrySchema = z.object({
  provider_name: z.string(),
  model_name: z.string(),
});

const runtimeToolchainConfigSchema = z.object({
  toolchains: z
    .array(z.object({ tool: z.string(), version: z.string() }))
    .default([]),
  aptPackages: z.array(z.string()).optional(),
  caches: z.array(z.object({ id: z.string(), path: z.string() })).optional(),
  disableCaches: z.array(z.string()).optional(),
});

const formSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    provider_name: z.string().optional(),
    model_name: z.string().optional(),
    tier_preference: z.enum(["light", "heavy"]).optional().or(z.literal("")),
    allowed_tools: z.array(z.string()).default([]),
    denied_tools: z.array(z.string()).default([]),
    approval_required_tools: z.array(z.string()).default([]),
    skill_ids: z.array(z.string()).default([]),
    system_prompt: z.string().optional(),
    harness_contributions: z
      .record(z.string(), z.any())
      .nullable()
      .default(null),
    thinking_level: z.string().nullable().optional(),
    fallback_chain: z.array(fallbackChainEntrySchema).default([]),
    runtime_toolchains: runtimeToolchainConfigSchema.default({
      toolchains: [],
    }),
  })
  .refine(
    (data) => {
      const allowed = new Set(data.allowed_tools);
      const denied = new Set(data.denied_tools);
      const approvalRequired = new Set(data.approval_required_tools);
      for (const tool of allowed) {
        if (denied.has(tool) || approvalRequired.has(tool)) return false;
      }
      for (const tool of denied) {
        if (approvalRequired.has(tool)) return false;
      }
      return true;
    },
    {
      message:
        "A tool cannot appear in more than one of Allowed, Denied, or Approval Required",
      path: ["allowed_tools"],
    },
  );

type FormData = z.infer<typeof formSchema>;

interface AgentProfileFormProps {
  profile?: AgentProfile;
  providers: LLMProvider[];
  models: LLMModel[];
  tools: Tool[];
  onSubmit: (data: {
    name: string;
    provider_name?: string;
    model_name?: string;
    tier_preference?: "light" | "heavy" | "";
    allowed_tools: string[];
    denied_tools: string[];
    approval_required_tools: string[];
    skill_ids: string[];
    system_prompt?: string;
    harness_contributions?: Record<string, unknown> | null;
    thinking_level?: string | null;
    fallback_chain: Array<{ provider_name: string; model_name: string }>;
    runtime_toolchains: RuntimeToolchainConfig;
  }) => void;
  skills: AgentSkill[];
  initialSkillIds?: string[];
  onCancel: () => void;
  isSubmitting: boolean;
}

interface AgentProfileFormBodyProps {
  form: UseFormReturn<FormData>;
  profile?: AgentProfile;
  providers: LLMProvider[];
  models: LLMModel[];
  skills: AgentSkill[];
  tools: Tool[];
  filteredModels: LLMModel[];
  handleProviderChange: (value: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}

function getSubmitLabel(
  profile: AgentProfile | undefined,
  isSubmitting: boolean,
): string {
  if (isSubmitting) {
    return "Saving...";
  }

  return profile ? "Update" : "Create";
}

function stringOrEmpty(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function normalizeTierPreference(
  value: AgentProfile["tier_preference"],
): "light" | "heavy" | "" | undefined {
  if (value === "light" || value === "heavy") {
    return value;
  }

  if (value === null) {
    return "";
  }

  return undefined;
}

function buildAdvancedRoutingDefaults(
  profile?: AgentProfile,
): Pick<
  FormData,
  | "harness_contributions"
  | "thinking_level"
  | "fallback_chain"
  | "runtime_toolchains"
> {
  return {
    harness_contributions: profile?.harness_contributions ?? null,
    thinking_level: profile?.thinking_level ?? null,
    fallback_chain: profile?.fallback_chain ?? [],
    runtime_toolchains: profile?.runtime_toolchains ?? { toolchains: [] },
  };
}

function buildFormDefaults(profile?: AgentProfile): FormData {
  const categorized = buildCategorizedToolLists(profile?.tool_policy?.rules);

  return {
    name: stringOrEmpty(profile?.name),
    provider_name: stringOrEmpty(profile?.provider_name),
    model_name: stringOrEmpty(profile?.model_name),
    tier_preference: normalizeTierPreference(profile?.tier_preference),
    allowed_tools: categorized.allowed_tools,
    denied_tools: categorized.denied_tools,
    approval_required_tools: categorized.approval_required_tools,
    skill_ids: [],
    system_prompt: stringOrEmpty(profile?.system_prompt),
    ...buildAdvancedRoutingDefaults(profile),
  };
}

function filterModelsByProvider(
  models: LLMModel[],
  selectedProvider: string | undefined,
): LLMModel[] {
  if (!selectedProvider) {
    return models;
  }

  return models.filter((model) => model.provider_name === selectedProvider);
}

function ThinkingLevelProfileField({
  form,
}: Readonly<{ form: UseFormReturn<FormData> }>) {
  return (
    <FormField
      control={form.control}
      name="thinking_level"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Thinking Level</FormLabel>
          <Select
            onValueChange={(value) =>
              field.onChange(value === INHERIT_THINKING_LEVEL ? null : value)
            }
            value={field.value ?? INHERIT_THINKING_LEVEL}
          >
            <FormControl>
              <SelectTrigger aria-label="Thinking level">
                <SelectValue placeholder="Inherit" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={INHERIT_THINKING_LEVEL}>Inherit</SelectItem>
              {(THINKING_LEVEL_ORDER as readonly string[]).map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function AgentProfileFormBody({
  form,
  profile,
  providers,
  models,
  skills,
  tools,
  filteredModels,
  handleProviderChange,
  onCancel,
  isSubmitting,
  submitLabel,
}: Readonly<AgentProfileFormBodyProps>) {
  return (
    <>
      <AgentProfileEditorTabs
        basicInfo={
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Default Agent" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <ProviderAndModelFields
              form={form}
              providers={providers}
              filteredModels={filteredModels}
              handleProviderChange={handleProviderChange}
              noneOptionValue={NONE_OPTION_VALUE}
            />

            <FormField
              control={form.control}
              name="tier_preference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tier Preference</FormLabel>
                  <Select
                    onValueChange={(value) =>
                      field.onChange(value === NONE_OPTION_VALUE ? "" : value)
                    }
                    value={field.value || NONE_OPTION_VALUE}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select tier preference" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_OPTION_VALUE}>None</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="heavy">Heavy</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <ThinkingLevelProfileField form={form} />
          </div>
        }
        toolsAndSkills={
          <div className="space-y-4">
            <ToolPermissionsTable form={form} tools={tools} />
            <AssignedSkillsField form={form} skills={skills} />
          </div>
        }
        systemAndProvenance={
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="system_prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>System Prompt</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter the system prompt for this agent..."
                      className="min-h-[200px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <HarnessContributionsField
              value={
                (form.watch("harness_contributions") as Record<
                  string,
                  unknown
                > | null) ?? null
              }
              onChange={(next) =>
                form.setValue("harness_contributions", next, {
                  shouldDirty: true,
                })
              }
            />

            <div className="space-y-2">
              <FormLabel>Fallback Chain</FormLabel>
              <p className="text-xs text-muted-foreground">
                Ordered provider/model pairs tried when the primary fails.
                Overrides the global default for this profile.
              </p>
              <FormField
                control={form.control}
                name="fallback_chain"
                render={({ field }) => (
                  <FallbackChainEditor
                    value={field.value}
                    onChange={field.onChange}
                    providers={providers}
                    models={models}
                  />
                )}
              />
            </div>

            <div className="space-y-2">
              <FormLabel>Runtime Toolchains</FormLabel>
              <p className="text-xs text-muted-foreground">
                Language/tool versions, apt packages, and caches to provision in
                this agent&apos;s execution container.
              </p>
              <FormField
                control={form.control}
                name="runtime_toolchains"
                render={({ field }) => (
                  <RuntimeToolchainEditor
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            {profile && <AgentProfileProvenance profile={profile} />}
          </div>
        }
      />

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

export function AgentProfileForm({
  profile,
  providers,
  models,
  tools,
  skills,
  initialSkillIds,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<AgentProfileFormProps>) {
  const submitLabel = getSubmitLabel(profile, isSubmitting);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema as any),
    defaultValues: buildFormDefaults(profile),
  });

  useEffect(() => {
    form.setValue("skill_ids", initialSkillIds ?? []);
  }, [form, initialSkillIds]);

  const selectedProvider = useWatch({
    control: form.control,
    name: "provider_name",
  });
  const filteredModels = useMemo(
    () => filterModelsByProvider(models, selectedProvider),
    [selectedProvider, models],
  );
  const handleProviderChange = (value: string) => {
    const nextProvider = value === NONE_OPTION_VALUE ? "" : value;
    form.setValue("provider_name", nextProvider);
    form.setValue("model_name", "");
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <AgentProfileFormBody
          form={form}
          profile={profile}
          providers={providers}
          models={models}
          skills={skills}
          tools={tools}
          filteredModels={filteredModels}
          handleProviderChange={handleProviderChange}
          onCancel={onCancel}
          isSubmitting={isSubmitting}
          submitLabel={submitLabel}
        />
      </form>
    </Form>
  );
}
