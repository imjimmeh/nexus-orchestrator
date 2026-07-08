import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus } from "lucide-react";
import { CredentialBindingPanel } from "@/components/harnesses/CredentialBindingPanel";
import { DeviceFlowModal } from "@/components/harnesses/DeviceFlowModal";
import { ScopedDefaultsForm } from "@/components/harnesses/ScopedDefaultsForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useHarnesses,
  useCreateHarness,
  useDeleteHarness,
  useValidateHarness,
} from "@/hooks/useHarnesses";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import type { HarnessDefinition } from "@/lib/api/harness-api.types";

const TRANSPORT_OPTIONS = [
  { value: "stdio", label: "stdio" },
  { value: "http", label: "HTTP" },
  { value: "websocket", label: "WebSocket" },
];

const registerFormSchema = z.object({
  harnessId: z
    .string()
    .min(1, "Harness ID is required")
    .regex(/^custom:/, 'Harness ID must start with "custom:"'),
  displayName: z.string().min(1, "Display name is required"),
  imageRef: z.string().min(1, "Image reference is required"),
  transport: z.string().min(1, "Transport is required"),
});

type RegisterFormData = z.infer<typeof registerFormSchema>;

interface RegisterHarnessFormProps {
  onSubmit: (data: RegisterFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function RegisterHarnessForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<RegisterHarnessFormProps>) {
  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerFormSchema as any),
    defaultValues: {
      harnessId: "custom:",
      displayName: "",
      imageRef: "",
      transport: "stdio",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="harnessId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Harness ID</FormLabel>
              <FormControl>
                <Input placeholder="custom:my-harness" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display Name</FormLabel>
              <FormControl>
                <Input placeholder="My Custom Harness" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="imageRef"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Image Reference</FormLabel>
              <FormControl>
                <Input placeholder="registry/image:tag" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="transport"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Transport</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select transport" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TRANSPORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Registering..." : "Register"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

interface HarnessTableRowProps {
  harness: HarnessDefinition;
  onDelete: (harness: HarnessDefinition) => void;
  onValidate: (harness: HarnessDefinition) => void;
  onToggleCredentials: (harness: HarnessDefinition) => void;
  isValidating: boolean;
  isCredentialsExpanded: boolean;
}

function HarnessTableRow({
  harness,
  onDelete,
  onValidate,
  onToggleCredentials,
  isValidating,
  isCredentialsExpanded,
}: Readonly<HarnessTableRowProps>) {
  const isBuiltin = harness.source === "builtin";

  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{harness.harnessId}</TableCell>
      <TableCell>{harness.displayName}</TableCell>
      <TableCell>
        <Badge variant={isBuiltin ? "secondary" : "outline"}>
          {harness.source}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {harness.transport}
      </TableCell>
      <TableCell>
        <Badge variant={harness.enabled ? "default" : "secondary"}>
          {harness.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onToggleCredentials(harness)}
            aria-expanded={isCredentialsExpanded}
          >
            Credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onValidate(harness)}
            disabled={isValidating}
          >
            {isValidating ? "Validating..." : "Validate"}
          </Button>
          {!isBuiltin && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(harness)}>
              Delete
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function HarnessesAdminPage() {
  // Harness registrations are platform-plane config: HarnessConfigController's
  // list endpoint has no scopeNodeId filter (unlike the Task 7 default-deny
  // endpoints), so this list is never scope-partitioned. Read the active
  // scope only to inform the user the list is platform-wide - the query
  // itself intentionally stays unscoped so its key doesn't churn as the
  // active scope changes.
  const { activeScopeNodeId } = useScopeContext();
  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;
  const { data: harnesses = [], isLoading } = useHarnesses();
  const createHarness = useCreateHarness();
  const deleteHarness = useDeleteHarness();
  const validateHarness = useValidateHarness();

  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [expandedHarnessId, setExpandedHarnessId] = useState<string | null>(
    null,
  );
  const [deviceFlow, setDeviceFlow] = useState<{
    harnessId: string;
    credentialKey: string;
  } | null>(null);

  async function handleRegister(data: RegisterFormData) {
    await createHarness.mutateAsync({
      harnessId: data.harnessId,
      displayName: data.displayName,
      imageRef: data.imageRef,
      transport: data.transport,
    });
    setIsRegisterOpen(false);
  }

  async function handleDelete(harness: HarnessDefinition) {
    await deleteHarness.mutateAsync(harness.harnessId);
  }

  async function handleValidate(harness: HarnessDefinition) {
    setValidatingId(harness.harnessId);
    try {
      await validateHarness.mutateAsync(harness.harnessId);
    } finally {
      setValidatingId(null);
    }
  }

  function handleToggleCredentials(harness: HarnessDefinition) {
    setExpandedHarnessId((current) =>
      current === harness.harnessId ? null : harness.harnessId,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Harnesses</h2>
          <p className="text-muted-foreground">
            Manage execution harnesses for workflow steps
          </p>
        </div>
        <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Register Custom Harness
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Register Custom Harness</DialogTitle>
            </DialogHeader>
            <RegisterHarnessForm
              onSubmit={handleRegister}
              onCancel={() => setIsRegisterOpen(false)}
              isSubmitting={createHarness.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {!isGlobalScope && (
        <p className="text-sm text-muted-foreground">
          Harness registrations are platform-wide and are not confined to the
          currently active scope.
        </p>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold mb-4">Platform AI Defaults</h2>
        <ScopedDefaultsForm scopeNodeId="platform" />
      </div>

      <div className="rounded-md border bg-card text-card-foreground shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Harness ID</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Transport</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center h-24 text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            )}

            {!isLoading && harnesses.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center h-24 text-muted-foreground"
                >
                  No harnesses configured.
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              harnesses.map((harness) => (
                <React.Fragment key={harness.harnessId}>
                  <HarnessTableRow
                    harness={harness}
                    onDelete={handleDelete}
                    onValidate={handleValidate}
                    onToggleCredentials={handleToggleCredentials}
                    isValidating={validatingId === harness.harnessId}
                    isCredentialsExpanded={
                      expandedHarnessId === harness.harnessId
                    }
                  />
                  {expandedHarnessId === harness.harnessId && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30 px-6 py-4">
                        <CredentialBindingPanel
                          harnessId={harness.harnessId}
                          scopeNodeId={undefined}
                          onStartDeviceFlow={(credentialKey: string) =>
                            setDeviceFlow({
                              harnessId: harness.harnessId,
                              credentialKey,
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
          </TableBody>
        </Table>
      </div>

      {deviceFlow && (
        <DeviceFlowModal
          open
          harnessId={deviceFlow.harnessId}
          credentialKey={deviceFlow.credentialKey}
          scopeNodeId={undefined}
          onOpenChange={(next) => {
            if (!next) setDeviceFlow(null);
          }}
        />
      )}
    </div>
  );
}

export { HarnessesAdminPage };
