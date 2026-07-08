import { useMemo, useState } from "react";
import {
  FlaskConical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateAcpServer,
  useDeleteAcpServer,
  useAcpServers,
  useAcpDiscoveredAgents,
  useReloadAcpServer,
  useReloadAcpServers,
  useTestAcpServer,
  useUpdateAcpServer,
} from "@/hooks/useAcpServers";
import { AcpServer, AcpServerTestResult, CreateAcpServerRequest } from "@/lib/api/acp.types";
import { AcpServerFormDialog } from "./AcpServerFormDialog";
import { authTypeLabel, statusVariant } from "./acp-servers-card.utils";

type AcpServersTableProps = {
  isLoading: boolean;
  servers: AcpServer[];
  testResultByServer: Record<string, AcpServerTestResult>;
  testPending: boolean;
  reloadPending: boolean;
  expandedServerId: string | null;
  onToggleExpand: (serverId: string) => void;
  onTestServer: (server: AcpServer) => void;
  onReloadServer: (server: AcpServer) => void;
  onEditServer: (server: AcpServer) => void;
  onDeleteServer: (server: AcpServer) => void;
};

function AcpServersTable({
  isLoading,
  servers,
  testResultByServer,
  testPending,
  reloadPending,
  expandedServerId,
  onToggleExpand,
  onTestServer,
  onReloadServer,
  onEditServer,
  onDeleteServer,
}: Readonly<AcpServersTableProps>) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Auth</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Agents</TableHead>
            <TableHead>Last Connected</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center">
                Loading ACP servers...
              </TableCell>
            </TableRow>
          ) : servers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center">
                No ACP servers configured.
              </TableCell>
            </TableRow>
          ) : (
            servers.map((server) => {
              const latestTestResult = testResultByServer[server.id];
              const isExpanded = expandedServerId === server.id;

              return (
                <>
                  <TableRow key={server.id}>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => onToggleExpand(server.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{server.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {server.url}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {authTypeLabel(server.auth_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(server.last_status)}>
                        {server.last_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {server.last_discovered_agent_count ?? 0}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {server.last_connected_at
                        ? new Date(server.last_connected_at).toLocaleString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            latestTestResult && !latestTestResult.ok
                              ? (latestTestResult.error ?? "Test failed")
                              : "Test connection"
                          }
                          onClick={() => onTestServer(server)}
                          disabled={testPending}
                        >
                          <FlaskConical className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reload server agents"
                          onClick={() => onReloadServer(server)}
                          disabled={reloadPending}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit server"
                          onClick={() => onEditServer(server)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete server"
                          onClick={() => onDeleteServer(server)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow key={`${server.id}-agents`}>
                      <TableCell colSpan={8} className="p-4">
                        <DiscoveredAgentsList serverId={server.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function DiscoveredAgentsList({ serverId }: { serverId: string }) {
  const { data: agents = [], isLoading } = useAcpDiscoveredAgents(serverId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading agents...</p>;
  }

  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No agents discovered on this server.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="h-4 w-4" />
        Discovered Agents ({agents.length})
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <div key={agent.id} className="rounded-md border p-3 text-sm">
            <div className="font-medium">{agent.agent_name}</div>
            {agent.description && (
              <p className="text-xs text-muted-foreground mt-1">
                {agent.description}
              </p>
            )}
            {agent.registry_tool_name && (
              <Badge variant="outline" className="mt-2 text-xs">
                {agent.registry_tool_name}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type DeleteAcpServerDialogProps = {
  target: AcpServer | null;
  onCancel: () => void;
  onConfirm: (server: AcpServer) => void;
};

function DeleteAcpServerDialog({
  target,
  onCancel,
  onConfirm,
}: Readonly<DeleteAcpServerDialogProps>) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete ACP server?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the server configuration and all discovered agents from
            the catalog.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (target) {
                onConfirm(target);
              }
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AcpServersCard() {
  const { data: servers = [], isLoading } = useAcpServers();

  const createServer = useCreateAcpServer();
  const updateServer = useUpdateAcpServer();
  const deleteServer = useDeleteAcpServer();
  const testServer = useTestAcpServer();
  const reloadServer = useReloadAcpServer();
  const reloadAllServers = useReloadAcpServers();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<AcpServer | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AcpServer | null>(null);
  const [testResultByServer, setTestResultByServer] = useState<
    Record<string, AcpServerTestResult>
  >({});
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );

  const isSubmitting =
    createServer.isPending || updateServer.isPending || deleteServer.isPending;

  const handleToggleExpand = (serverId: string) => {
    setExpandedServerId((prev) => (prev === serverId ? null : serverId));
  };

  const handleSave = async (payload: CreateAcpServerRequest) => {
    try {
      if (editingServer) {
        await updateServer.mutateAsync({
          id: editingServer.id,
          data: payload,
        });
      } else {
        await createServer.mutateAsync(payload);
      }

      setIsDialogOpen(false);
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Unable to save ACP server configuration",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          ACP Servers
        </CardTitle>
        <CardDescription>
          Manage connections to external ACP (Agent Communication Protocol)
          servers and discover available agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void reloadAllServers.mutateAsync();
            }}
            disabled={reloadAllServers.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload All
          </Button>
          <Button
            onClick={() => {
              setEditingServer(null);
              setSaveError(null);
              setIsDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add ACP Server
          </Button>
        </div>

        <AcpServersTable
          isLoading={isLoading}
          servers={sortedServers}
          testResultByServer={testResultByServer}
          testPending={testServer.isPending}
          reloadPending={reloadServer.isPending}
          expandedServerId={expandedServerId}
          onToggleExpand={handleToggleExpand}
          onTestServer={(server) => {
            void testServer.mutateAsync(server.id).then((result) => {
              setTestResultByServer((previous) => ({
                ...previous,
                [server.id]: result,
              }));
            });
          }}
          onReloadServer={(server) => {
            void reloadServer.mutateAsync(server.id);
          }}
          onEditServer={(server) => {
            setEditingServer(server);
            setSaveError(null);
            setIsDialogOpen(true);
          }}
          onDeleteServer={(server) => {
            setDeleteTarget(server);
          }}
        />
      </CardContent>

      <AcpServerFormDialog
        open={isDialogOpen}
        server={editingServer}
        isSubmitting={isSubmitting}
        errorMessage={saveError}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleSave}
      />

      <DeleteAcpServerDialog
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(server) => {
          void deleteServer.mutateAsync(server.id);
          setDeleteTarget(null);
        }}
      />
    </Card>
  );
}
