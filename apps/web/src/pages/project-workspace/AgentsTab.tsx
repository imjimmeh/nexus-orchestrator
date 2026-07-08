import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { queryKeys } from "@/lib/queryKeys";
import { ProjectAgentsDocument } from "@/lib/api/projects.types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface AgentsTabProps {
  readonly projectId: string;
}

interface AgentsBaseline {
  content: string;
  etag: string | null;
  exists: boolean;
  path: string;
  updatedAt: string | null;
}

function toBaseline(document: ProjectAgentsDocument): AgentsBaseline {
  return {
    content: document.content,
    etag: document.etag,
    exists: document.exists,
    path: document.path,
    updatedAt: document.updatedAt,
  };
}

function shouldDiscardUnsavedChanges(hasUnsavedChanges: boolean): boolean {
  if (!hasUnsavedChanges) {
    return true;
  }

  return globalThis.window.confirm(
    "Discard unsaved AGENTS.md changes and reload from the repository?",
  );
}

interface AgentsInstructionsCardProps {
  baseline: AgentsBaseline;
  draftContent: string;
  isDirty: boolean;
  conflictMessage: string | null;
  savePending: boolean;
  queryFetching: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onReload: () => void;
}

interface AgentsErrorCardProps {
  message: string;
  onRetry: () => void;
}

function AgentsLoadingCard() {
  return (
    <Card>
      <CardContent className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading AGENTS.md...</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentsErrorCard({ message, onRetry }: Readonly<AgentsErrorCardProps>) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function resolveFileLabel(exists: boolean): string {
  return exists ? "Tracked AGENTS.md" : "New AGENTS.md";
}

function AgentsInstructionsCard({
  baseline,
  draftContent,
  isDirty,
  conflictMessage,
  savePending,
  queryFetching,
  onDraftChange,
  onSave,
  onReset,
  onReload,
}: Readonly<AgentsInstructionsCardProps>) {
  const fileLabel = resolveFileLabel(baseline.exists);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>AGENTS Instructions</span>
          {isDirty ? (
            <Badge variant="secondary">Unsaved changes</Badge>
          ) : (
            <Badge variant="outline">Up to date</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{fileLabel}</span>
          <span>•</span>
          <span>{baseline.path}</span>
          <span>•</span>
          <span>
            {baseline.etag
              ? `etag ${baseline.etag.slice(0, 10)}...`
              : "no existing etag"}
          </span>
        </div>

        {conflictMessage ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{conflictMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="agents-editor">AGENTS.md</Label>
          <Textarea
            id="agents-editor"
            value={draftContent}
            onChange={(event) => {
              onDraftChange(event.target.value);
            }}
            className="min-h-[420px] font-mono text-xs"
            placeholder="Define repository-specific agent instructions here..."
            disabled={savePending}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onSave} disabled={!isDirty || savePending}>
            {savePending ? "Saving..." : "Save AGENTS.md"}
          </Button>
          <Button variant="outline" onClick={onReset} disabled={!isDirty}>
            Reset
          </Button>
          <Button
            variant="outline"
            onClick={onReload}
            disabled={savePending || queryFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function useDirtyBeforeUnloadGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    globalThis.window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      globalThis.window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);
}

export function AgentsTab({ projectId }: Readonly<AgentsTabProps>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const agentsFileKey = useMemo(
    () => queryKeys.projects.agentsFile(projectId),
    [projectId],
  );

  const [baseline, setBaseline] = useState<AgentsBaseline | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const agentsFileQuery = useQuery({
    queryKey: agentsFileKey,
    queryFn: () => api.getProjectAgentsFile(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!agentsFileQuery.data || isDirty) {
      return;
    }

    const nextBaseline = toBaseline(agentsFileQuery.data);
    setBaseline(nextBaseline);
    setDraftContent(nextBaseline.content);
    setConflictMessage(null);
  }, [agentsFileQuery.data, isDirty]);

  useDirtyBeforeUnloadGuard(isDirty);

  const saveAgentsFile = useMutation({
    mutationFn: (content: string) =>
      api.updateProjectAgentsFile(projectId, {
        content,
        expectedEtag: baseline?.etag ?? null,
      }),
    onSuccess: (document) => {
      const nextBaseline = toBaseline(document);
      queryClient.setQueryData(agentsFileKey, document);
      setBaseline(nextBaseline);
      setDraftContent(nextBaseline.content);
      setIsDirty(false);
      setConflictMessage(null);
      toast.success("Saved AGENTS.md", "Project instructions were updated.");
    },
    onError: (error) => {
      const message = getApiErrorMessage(
        error,
        "Failed to save AGENTS.md content.",
      );

      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setConflictMessage(message);
        toast.warning("AGENTS.md changed", message);
        return;
      }

      toast.error("Failed to save AGENTS.md", message);
    },
  });

  const handleDraftChange = (value: string) => {
    setDraftContent(value);
    setIsDirty(value !== (baseline?.content ?? ""));
    if (conflictMessage) {
      setConflictMessage(null);
    }
  };

  const handleReset = () => {
    if (!baseline) {
      return;
    }

    setDraftContent(baseline.content);
    setIsDirty(false);
    setConflictMessage(null);
  };

  const handleReload = async () => {
    if (!shouldDiscardUnsavedChanges(isDirty)) {
      return;
    }

    setIsDirty(false);
    setConflictMessage(null);
    const refreshed = await agentsFileQuery.refetch();
    if (!refreshed.data) {
      return;
    }

    const nextBaseline = toBaseline(refreshed.data);
    setBaseline(nextBaseline);
    setDraftContent(nextBaseline.content);
  };

  const handleSave = async () => {
    try {
      await saveAgentsFile.mutateAsync(draftContent);
    } catch {
      // Mutation error state is handled by onError for conflict and toast feedback.
    }
  };

  if (agentsFileQuery.isLoading && !baseline) {
    return <AgentsLoadingCard />;
  }

  if (agentsFileQuery.isError && !baseline) {
    const message = getApiErrorMessage(
      agentsFileQuery.error,
      "Unable to load AGENTS.md from the repository.",
    );
    return (
      <AgentsErrorCard
        message={message}
        onRetry={() => {
          void agentsFileQuery.refetch();
        }}
      />
    );
  }

  if (!baseline) {
    return <AgentsLoadingCard />;
  }

  return (
    <AgentsInstructionsCard
      baseline={baseline}
      draftContent={draftContent}
      isDirty={isDirty}
      conflictMessage={conflictMessage}
      savePending={saveAgentsFile.isPending}
      queryFetching={agentsFileQuery.isFetching}
      onDraftChange={handleDraftChange}
      onSave={() => {
        void handleSave();
      }}
      onReset={handleReset}
      onReload={() => {
        void handleReload();
      }}
    />
  );
}
