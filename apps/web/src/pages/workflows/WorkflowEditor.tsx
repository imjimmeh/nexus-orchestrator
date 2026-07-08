import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
} from "@/hooks/useWorkflows";
import { YamlEditor } from "@/components/workflow/YamlEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save, X } from "lucide-react";

const defaultYaml = `workflow_id: example_workflow
name: Example Workflow
description: A sample workflow
permissions:
  allow_tools: [read_file, write_file]
  deny_tools: []
  approval_required_tools: []
trigger:
  type: webhook
  event: github.push
jobs:
  - id: job_1
    type: execution
    tier: light
    depends_on: []
    inputs:
      agent_profile: default
      model: gpt-4
      provider: openai
    steps:
      - id: step_1
        prompt: |
          This is the first step of job_1.
          You can add multiple steps that run sequentially in the same container.
    permissions:
      allow_tools: [query_memory]
    transitions:
      - condition: "true"
        next: job_2
  - id: job_2
    type: invoke_workflow
    tier: heavy
    depends_on:
      - job_1
    workflow_id: child_workflow_id
    wait_for_completion: true
`;

export function WorkflowEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const { data: existingWorkflow, isLoading: isLoadingWorkflow } = useWorkflow(
    id || "",
  );
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();

  const [name, setName] = useState("");
  const [yaml, setYaml] = useState(defaultYaml);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (isEditMode && existingWorkflow) {
      setName(existingWorkflow.name);
      setYaml(existingWorkflow.yaml_definition);
      setIsActive(existingWorkflow.is_active);
    }
  }, [isEditMode, existingWorkflow]);

  const handleSave = async () => {
    if (!name.trim()) return;

    try {
      if (isEditMode && id) {
        await updateWorkflow.mutateAsync({
          id,
          data: {
            name,
            yaml_definition: yaml,
            is_active: isActive,
          },
        });
        navigate(`/workflows/${id}`);
      } else {
        const result = await createWorkflow.mutateAsync({
          name,
          yaml_definition: yaml,
          is_active: isActive,
        });
        navigate(`/workflows/${result.id}`);
      }
    } catch (error) {
      console.error("Failed to save workflow:", error);
    }
  };

  const handleCancel = () => {
    if (isEditMode && id) {
      navigate(`/workflows/${id}`);
    } else {
      navigate("/workflows");
    }
  };

  if (isEditMode && isLoadingWorkflow) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>Loading workflow...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={handleCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              {isEditMode ? "Edit Workflow" : "Create Workflow"}
            </h2>
            <p className="text-muted-foreground">
              {isEditMode
                ? "Update your workflow configuration"
                : "Define a new automated workflow"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCancel}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !name.trim() ||
              createWorkflow.isPending ||
              updateWorkflow.isPending
            }
          >
            <Save className="mr-2 h-4 w-4" />
            {createWorkflow.isPending || updateWorkflow.isPending
              ? "Saving..."
              : "Save Workflow"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workflow Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter workflow name"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="isActive" className="font-normal">
                Active
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>YAML Definition</CardTitle>
          </CardHeader>
          <CardContent>
            <YamlEditor
              value={yaml}
              onChange={(value) => setYaml(value || "")}
              height="500px"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permission and Composition Guide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure permission hierarchy directly in YAML using{" "}
              <code>permissions</code> at workflow and step scopes. Step
              permissions can broaden or narrow workflow defaults.
            </p>
            <pre className="rounded bg-muted p-3 text-xs overflow-auto">
              {`permissions:
  allow_tools: [read_file, write_file]
  deny_tools: [bash]
  approval_required_tools: [write_file]

steps:
  - id: secure_review
    type: execution
    tier: light
    permissions:
      allow_tools: [query_memory]

  - id: create_reusable_tool
    type: register_tool
    tier: light
    inputs:
      name: custom_tool
      tier_restriction: 1
      schema: { type: object, properties: {} }
      typescript_code: |
        export const tool = {
          execute: async () => ({ ok: true })
        }`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
