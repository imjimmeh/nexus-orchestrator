import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type {
  ConcurrencyConfig,
  TriggerConfig,
} from "../hooks/useWorkflowEditorStore.types";
import { TextField } from "./fields/TextField";
import { TextareaField } from "./fields/TextareaField";
import { SwitchField } from "./fields/SwitchField";
import { SelectField } from "./fields/SelectField";
import { KeyValueField } from "./fields/KeyValueField";
import { KANBAN_COLUMNS } from "@/pages/kanban/kanban.utils";

const TRIGGER_TYPE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "event", label: "Event" },
  { value: "webhook", label: "Webhook" },
];

const LIFECYCLE_TRIGGER_TYPE_OPTION = {
  value: "lifecycle",
  label: "Lifecycle",
};

const DEFAULT_LIFECYCLE_PHASE = "ready-to-merge";
const DEFAULT_LIFECYCLE_HOOK = "before";

const LIFECYCLE_PHASE_OPTIONS = KANBAN_COLUMNS.map((column) => ({
  value: column.status,
  label: column.title,
}));

const LIFECYCLE_HOOK_OPTIONS = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
];

const DEFAULT_LIFECYCLE_TRIGGER: TriggerConfig = {
  type: "lifecycle",
  phase: DEFAULT_LIFECYCLE_PHASE,
  hook: DEFAULT_LIFECYCLE_HOOK,
  blocking: true,
};

const DEFAULT_EXISTING_LIFECYCLE_TRIGGER: TriggerConfig = {
  type: "lifecycle",
  phase: DEFAULT_LIFECYCLE_PHASE,
  hook: DEFAULT_LIFECYCLE_HOOK,
};

const SCOPE_OPTIONS = [
  { value: "workflow", label: "Workflow" },
  { value: "scope", label: "Scope" },
  { value: "context", label: "Context" },
];

const ON_CONFLICT_OPTIONS = [
  { value: "skip", label: "Skip" },
  { value: "queue", label: "Queue" },
  { value: "cancel_running", label: "Cancel Running" },
];

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <Button
        type="button"
        variant="ghost"
        className="w-full flex items-center justify-between px-3 py-2 h-auto font-medium"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={title}
      >
        <span>{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
      </Button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

interface TriggerSectionProps {
  supportsLifecycleTriggers: boolean;
}

interface LifecycleTriggerFieldsProps {
  lifecycleTrigger: TriggerConfig;
  onChange: (partial: Partial<TriggerConfig>) => void;
}

function hasKnownLifecyclePhase(phase: string) {
  return LIFECYCLE_PHASE_OPTIONS.some((option) => option.value === phase);
}

function buildLifecyclePhaseOptions(phase: string) {
  if (hasKnownLifecyclePhase(phase) || phase === "") {
    return LIFECYCLE_PHASE_OPTIONS;
  }

  return [
    ...LIFECYCLE_PHASE_OPTIONS,
    { value: phase, label: `Custom: ${phase}` },
  ];
}

function buildLifecycleTrigger(trigger: TriggerConfig | null | undefined) {
  if (trigger?.type !== "lifecycle") {
    return DEFAULT_LIFECYCLE_TRIGGER;
  }

  return {
    ...DEFAULT_EXISTING_LIFECYCLE_TRIGGER,
    ...trigger,
  };
}

function LifecycleTriggerFields({
  lifecycleTrigger,
  onChange,
}: LifecycleTriggerFieldsProps) {
  const lifecyclePhase = lifecycleTrigger.phase ?? DEFAULT_LIFECYCLE_PHASE;
  const isKnownPhase = hasKnownLifecyclePhase(lifecyclePhase);

  return (
    <>
      <SelectField
        label="Phase"
        value={lifecyclePhase}
        onChange={(phase) => onChange({ phase })}
        options={buildLifecyclePhaseOptions(lifecyclePhase)}
      />
      {!isKnownPhase && (
        <TextField
          label="Custom Phase"
          value={lifecyclePhase}
          onChange={(phase) => onChange({ phase })}
          placeholder="Enter lifecycle phase"
        />
      )}
      <SelectField
        label="Hook"
        value={lifecycleTrigger.hook ?? DEFAULT_LIFECYCLE_HOOK}
        onChange={(hook) => onChange({ hook })}
        options={LIFECYCLE_HOOK_OPTIONS}
      />
      <SwitchField
        label="Blocking"
        checked={
          lifecycleTrigger.blocking ?? lifecycleTrigger.hook === "before"
        }
        onChange={(blocking) => onChange({ blocking })}
      />
    </>
  );
}

function TriggerSection({ supportsLifecycleTriggers }: TriggerSectionProps) {
  const trigger = useWorkflowEditorStore((s) => s.trigger);
  const setMetadata = useWorkflowEditorStore((s) => s.setMetadata);
  const triggerTypeOptions = supportsLifecycleTriggers
    ? [...TRIGGER_TYPE_OPTIONS, LIFECYCLE_TRIGGER_TYPE_OPTION]
    : TRIGGER_TYPE_OPTIONS;
  const isLifecycleTrigger =
    supportsLifecycleTriggers && trigger?.type === "lifecycle";
  const lifecycleTrigger = buildLifecycleTrigger(trigger);

  function handleTypeChange(type: string) {
    if (type === "lifecycle") {
      setMetadata({
        trigger: lifecycleTrigger,
      });
      return;
    }

    const nextTrigger = {
      ...(trigger ?? { type: "manual" }),
      type,
    } as TriggerConfig;

    delete nextTrigger.phase;
    delete nextTrigger.hook;
    delete nextTrigger.blocking;

    setMetadata({ trigger: nextTrigger });
  }

  function handleLifecycleChange(partial: Partial<TriggerConfig>) {
    setMetadata({
      trigger: {
        ...lifecycleTrigger,
        ...partial,
      },
    });
  }

  return (
    <CollapsibleSection title="Trigger">
      <SelectField
        label="Type"
        value={trigger?.type ?? "manual"}
        onChange={handleTypeChange}
        options={triggerTypeOptions}
      />
      {isLifecycleTrigger && (
        <LifecycleTriggerFields
          lifecycleTrigger={lifecycleTrigger}
          onChange={handleLifecycleChange}
        />
      )}
    </CollapsibleSection>
  );
}

function ConcurrencySection() {
  const concurrency = useWorkflowEditorStore((s) => s.concurrency);
  const setMetadata = useWorkflowEditorStore((s) => s.setMetadata);

  function handleChange(partial: Partial<ConcurrencyConfig>) {
    setMetadata({
      concurrency: {
        max_runs: 1,
        scope: "workflow",
        on_conflict: "skip",
        ...(concurrency ?? {}),
        ...partial,
      } as ConcurrencyConfig,
    });
  }

  return (
    <CollapsibleSection title="Concurrency">
      <div className="space-y-1.5">
        <Label htmlFor="concurrency-max-runs">Max Runs</Label>
        <Input
          id="concurrency-max-runs"
          type="number"
          value={concurrency?.max_runs ?? 1}
          onChange={(e) => handleChange({ max_runs: Number(e.target.value) })}
        />
      </div>
      <SelectField
        label="Scope"
        value={concurrency?.scope ?? "workflow"}
        onChange={(scope) =>
          handleChange({ scope: scope as ConcurrencyConfig["scope"] })
        }
        options={SCOPE_OPTIONS}
      />
      <SelectField
        label="On Conflict"
        value={concurrency?.on_conflict ?? "skip"}
        onChange={(on_conflict) =>
          handleChange({
            on_conflict: on_conflict as ConcurrencyConfig["on_conflict"],
          })
        }
        options={ON_CONFLICT_OPTIONS}
      />
    </CollapsibleSection>
  );
}

function PermissionsSection() {
  return (
    <CollapsibleSection title="Permissions">
      <div className="flex items-center gap-2 py-2">
        <Badge variant="secondary">Coming Soon</Badge>
        <p className="text-xs text-muted-foreground">
          Tool and host mount permission policies will be available in a future
          update.
        </p>
      </div>
    </CollapsibleSection>
  );
}

function EnvironmentSection() {
  const globalEnv = useWorkflowEditorStore((s) => s.globalEnv);
  const setMetadata = useWorkflowEditorStore((s) => s.setMetadata);

  return (
    <CollapsibleSection title="Environment">
      <KeyValueField
        label="Global Environment"
        entries={globalEnv}
        onChange={(entries) => setMetadata({ globalEnv: entries })}
        keyPlaceholder="KEY"
        valuePlaceholder="VALUE"
      />
    </CollapsibleSection>
  );
}

interface WorkflowPropertiesProps {
  supportsLifecycleTriggers?: boolean;
}

function WorkflowProperties({
  supportsLifecycleTriggers = false,
}: WorkflowPropertiesProps) {
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const name = useWorkflowEditorStore((s) => s.name);
  const description = useWorkflowEditorStore((s) => s.description);
  const active = useWorkflowEditorStore((s) => s.active);
  const setMetadata = useWorkflowEditorStore((s) => s.setMetadata);

  if (selectedElementId !== null) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        Select a node or edge to edit its properties
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="border rounded-lg p-3 space-y-3">
        <h3 className="font-medium text-sm">General</h3>
        <TextField
          label="Name"
          value={name}
          onChange={(value) => setMetadata({ name: value })}
          placeholder="Enter workflow name"
        />
        <TextareaField
          label="Description"
          value={description}
          onChange={(value) => setMetadata({ description: value })}
          placeholder="Enter description"
        />
        <SwitchField
          label="Active"
          checked={active}
          onChange={(value) => setMetadata({ active: value })}
        />
      </div>

      <TriggerSection supportsLifecycleTriggers={supportsLifecycleTriggers} />
      <ConcurrencySection />
      <PermissionsSection />
      <EnvironmentSection />
    </div>
  );
}

export { WorkflowProperties };
