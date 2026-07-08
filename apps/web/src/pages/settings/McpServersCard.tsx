import { useMemo, useState } from "react";
import {
  FlaskConical,
  ListTree,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
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
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useReloadMcpServer,
  useReloadMcpServers,
  useTestMcpServer,
  useUpdateMcpServer,
} from "@/hooks/useMcpServers";
import { api } from "@/lib/api/client";
import { CreateMcpServerRequest, McpServer, McpServerRegistryTool, McpServerTestResult } from "@/lib/api/mcp.types";
import { McpServerFormDialog } from "./McpServerFormDialog";
import { ToolApprovalRulesCard } from "./ToolApprovalRulesCard";

const MCP_SERVER_STATUS_CONNECTED = "connected" as McpServer["last_status"];
const MCP_SERVER_STATUS_FAILED = "failed" as McpServer["last_status"];
const MCP_SERVER_STATUS_DISABLED = "disabled" as McpServer["last_status"];

function statusVariant(
  status: McpServer["last_status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === MCP_SERVER_STATUS_CONNECTED) {
    return "default";
  }
  if (status === MCP_SERVER_STATUS_FAILED) {
    return "destructive";
  }
  if (status === MCP_SERVER_STATUS_DISABLED) {
    return "outline";
  }
  return "secondary";
}

type McpServersTableProps = {
  isLoading: boolean;
  servers: McpServer[];
  testResultByServer: Record<string, McpServerTestResult>;
  testPending: boolean;
  reloadPending: boolean;
  lineageLoadingByServer: Record<string, boolean>;
  lineageByServer: Record<string, McpServerRegistryTool[]>;
  onTestServer: (server: McpServer) => void;
  onReloadServer: (server: McpServer) => void;
  onTraceServerTools: (server: McpServer) => void;
  onEditServer: (server: McpServer) => void;
  onDeleteServer: (server: McpServer) => void;
};

function McpServersTable({
  isLoading,
  servers,
  testResultByServer,
  testPending,
  reloadPending,
  lineageLoadingByServer,
  lineageByServer,
  onTestServer,
  onReloadServer,
  onTraceServerTools,
  onEditServer,
  onDeleteServer,
}: Readonly<McpServersTableProps>) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Transport</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Tools</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center">
                Loading MCP servers...
              </TableCell>
            </TableRow>
          ) : servers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center">
                No MCP servers configured.
              </TableCell>
            </TableRow>
          ) : (
            servers.map((server) => {
              const latestTestResult = testResultByServer[server.id];
              const lineage = lineageByServer[server.id] ?? [];
              const isTracing = lineageLoadingByServer[server.id];

              return (
                <TableRow key={server.id}>
                  <TableCell className="font-medium">{server.name}</TableCell>
                  <TableCell className="uppercase">
                    {server.transport_type}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(server.last_status)}>
                      {server.last_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <div className="text-sm">
                        {server.last_discovered_tool_count ?? 0}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onTraceServerTools(server)}
                        disabled={isTracing}
                      >
                        <ListTree className="mr-2 h-4 w-4" />
                        Trace
                      </Button>
                      {lineage.length > 0 ? (
                        <p className="max-w-xs text-xs text-muted-foreground">
                          {lineage.map((tool) => tool.name).join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(server.updated_at).toLocaleString()}
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
                        title="Reload server tools"
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
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

type DeleteMcpServerDialogProps = {
  target: McpServer | null;
  onCancel: () => void;
  onConfirm: (server: McpServer) => void;
};

function DeleteMcpServerDialog({
  target,
  onCancel,
  onConfirm,
}: Readonly<DeleteMcpServerDialogProps>) {
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
          <AlertDialogTitle>Delete MCP server?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the server configuration and prunes synchronized MCP
            tools from the runtime catalog.
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

export function McpServersCard() {
  const { data: servers = [], isLoading } = useMcpServers();

  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const testServer = useTestMcpServer();
  const reloadServer = useReloadMcpServer();
  const reloadAllServers = useReloadMcpServers();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
  const [testResultByServer, setTestResultByServer] = useState<
    Record<string, McpServerTestResult>
  >({});
  const [lineageByServer, setLineageByServer] = useState<
    Record<string, McpServerRegistryTool[]>
  >({});
  const [lineageLoadingByServer, setLineageLoadingByServer] = useState<
    Record<string, boolean>
  >({});

  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );

  const isSubmitting =
    createServer.isPending || updateServer.isPending || deleteServer.isPending;

  const handleSave = async (payload: CreateMcpServerRequest) => {
    try {
      if (editingServer) {
        await updateServer.mutateAsync({ id: editingServer.id, data: payload });
      } else {
        await createServer.mutateAsync(payload);
      }

      setIsDialogOpen(false);
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Unable to save MCP server configuration",
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="h-5 w-5" />
            MCP Servers
          </CardTitle>
          <CardDescription>
            Register external MCP servers and synchronize discovered tools into
            the runtime tool catalog.
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
              Add MCP Server
            </Button>
          </div>

          <McpServersTable
            isLoading={isLoading}
            servers={sortedServers}
            testResultByServer={testResultByServer}
            testPending={testServer.isPending}
            reloadPending={reloadServer.isPending}
            lineageByServer={lineageByServer}
            lineageLoadingByServer={lineageLoadingByServer}
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
            onTraceServerTools={(server) => {
              setLineageLoadingByServer((current) => ({
                ...current,
                [server.id]: true,
              }));

              void api
                .getMcpServerTools(server.id)
                .then((tools) => {
                  setLineageByServer((current) => ({
                    ...current,
                    [server.id]: tools,
                  }));
                })
                .finally(() => {
                  setLineageLoadingByServer((current) => ({
                    ...current,
                    [server.id]: false,
                  }));
                });
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

          <McpServerFormDialog
            open={isDialogOpen}
            server={editingServer}
            isSubmitting={isSubmitting}
            errorMessage={saveError}
            onOpenChange={setIsDialogOpen}
            onSubmit={handleSave}
          />

          <DeleteMcpServerDialog
            target={deleteTarget}
            onCancel={() => {
              setDeleteTarget(null);
            }}
            onConfirm={(server) => {
              void deleteServer.mutateAsync(server.id).then(() => {
                setDeleteTarget(null);
              });
            }}
          />
        </CardContent>
      </Card>

      <ToolApprovalRulesCard />
    </div>
  );
}
