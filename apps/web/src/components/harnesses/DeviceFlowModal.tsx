import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCredentialOAuthStatus,
  useStartCredentialOAuth,
  useSubmitCredentialOAuthCode,
} from "@/hooks/useHarnessCredentials";
import { queryKeys } from "@/lib/queryKeys";
import type { OAuthStartResult } from "@/lib/api/harness-credentials-api.types";

interface DeviceFlowModalProps {
  open: boolean;
  harnessId: string;
  credentialKey: string;
  scopeNodeId: string | undefined;
  onOpenChange: (open: boolean) => void;
}

interface DeviceCodePanelProps {
  userCode: string;
  verificationUri: string;
}

function DeviceCodePanel({
  userCode,
  verificationUri,
}: Readonly<DeviceCodePanelProps>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Enter this code at the verification page:
        </p>
        <p className="text-2xl font-mono tracking-widest">{userCode}</p>
      </div>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Verification URL:</p>
        <a
          href={verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm break-all text-primary underline"
        >
          {verificationUri}
        </a>
      </div>
      <WaitingIndicator />
    </div>
  );
}

interface AuthCodePanelProps {
  authorizeUrl: string;
  instructions?: string;
  pastedCode: string;
  onPastedCodeChange: (value: string) => void;
  onSubmitCode: () => void;
  isSubmitting: boolean;
}

function AuthCodePanel({
  authorizeUrl,
  instructions,
  pastedCode,
  onPastedCodeChange,
  onSubmitCode,
  isSubmitting,
}: Readonly<AuthCodePanelProps>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          1. Authorize in your browser:
        </p>
        <a
          href={authorizeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-primary underline break-all"
        >
          Open the authorization page
        </a>
        {instructions && (
          <p className="text-xs text-muted-foreground">{instructions}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oauth-code" className="text-sm font-medium">
          2. Paste the authorization code or redirect URL
        </Label>
        <Input
          id="oauth-code"
          placeholder="Paste the code or full redirect URL here"
          value={pastedCode}
          onChange={(e) => onPastedCodeChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          If your browser completed the redirect automatically, you can wait —
          otherwise paste the value here.
        </p>
      </div>
      <WaitingIndicator />
      <div className="flex justify-end">
        <Button
          onClick={onSubmitCode}
          disabled={!pastedCode.trim() || isSubmitting}
        >
          {isSubmitting ? "Submitting..." : "Submit code"}
        </Button>
      </div>
    </div>
  );
}

function WaitingIndicator() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/10 bg-primary/5 p-3">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <p className="text-xs text-muted-foreground">
        Waiting for you to complete authorization in your browser...
      </p>
    </div>
  );
}

interface StatusBannerProps {
  loading: boolean;
  succeeded: boolean;
  errorMsg: string | null;
}

function StatusBanner({
  loading,
  succeeded,
  errorMsg,
}: Readonly<StatusBannerProps>) {
  if (loading) {
    return <p className="text-sm">Starting authorization...</p>;
  }
  if (succeeded) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
          <Check className="h-6 w-6 text-success" />
        </div>
        <p className="text-sm font-semibold">Credential authorized.</p>
      </div>
    );
  }
  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 py-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
      </div>
    );
  }
  return null;
}

interface ConnectPanelProps {
  session: OAuthStartResult;
  pastedCode: string;
  isSubmitting: boolean;
  onPastedCodeChange: (value: string) => void;
  onSubmitCode: () => void;
}

function ConnectPanel({
  session,
  pastedCode,
  isSubmitting,
  onPastedCodeChange,
  onSubmitCode,
}: Readonly<ConnectPanelProps>) {
  if (
    session.modality === "device" &&
    session.userCode &&
    session.verificationUri
  ) {
    return (
      <DeviceCodePanel
        userCode={session.userCode}
        verificationUri={session.verificationUri}
      />
    );
  }
  if (session.authorizeUrl) {
    return (
      <AuthCodePanel
        authorizeUrl={session.authorizeUrl}
        instructions={session.instructions}
        pastedCode={pastedCode}
        onPastedCodeChange={onPastedCodeChange}
        onSubmitCode={onSubmitCode}
        isSubmitting={isSubmitting}
      />
    );
  }
  return null;
}

function DeviceFlowModal({
  open,
  harnessId,
  credentialKey,
  scopeNodeId,
  onOpenChange,
}: Readonly<DeviceFlowModalProps>) {
  const queryClient = useQueryClient();
  const startOAuth = useStartCredentialOAuth();
  const submitCode = useSubmitCredentialOAuthCode();
  const [session, setSession] = useState<OAuthStartResult | null>(null);
  const [pastedCode, setPastedCode] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  // Store mutateAsync in a ref so the effect dependency array stays stable
  // while always calling the latest version of the function.
  const startRef = useRef(startOAuth.mutateAsync);
  useEffect(() => {
    startRef.current = startOAuth.mutateAsync;
  });

  useEffect(() => {
    if (!open) {
      setSession(null);
      setPastedCode("");
      setErrorMsg(null);
      setSucceeded(false);
      return;
    }

    let cancelled = false;
    void startRef
      .current({
        harnessId,
        key: credentialKey,
        body: { scopeNodeId },
      })
      .then((result) => {
        if (!cancelled) {
          setSession(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMsg(extractError(err, "Failed to start authorization"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, harnessId, credentialKey, scopeNodeId]);

  const statusQuery = useCredentialOAuthStatus(
    {
      harnessId,
      key: credentialKey,
      sessionId: session?.sessionId ?? "",
    },
    {
      enabled: open && !!session && !succeeded && !errorMsg,
    },
  );

  const status = statusQuery.data?.status;

  useEffect(() => {
    if (!status || status === "pending") {
      return;
    }
    if (status === "connected") {
      setSucceeded(true);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.harnessCredentials.requirements(
          harnessId,
          scopeNodeId,
        ),
      });
      return;
    }
    setErrorMsg(
      statusQuery.data?.error ??
        `Authorization ${status}. Close and try again.`,
    );
  }, [status, statusQuery.data?.error, harnessId, scopeNodeId, queryClient]);

  async function handleSubmitCode() {
    if (!session || !pastedCode.trim()) {
      return;
    }
    try {
      await submitCode.mutateAsync({
        harnessId,
        key: credentialKey,
        body: { session_id: session.sessionId, code: pastedCode.trim() },
      });
    } catch (err: unknown) {
      setErrorMsg(extractError(err, "Failed to submit code"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Connect via OAuth</DialogTitle>
          <DialogDescription>
            Authorize {credentialKey} for {harnessId}.
          </DialogDescription>
        </DialogHeader>

        <StatusBanner
          loading={!session && !errorMsg}
          succeeded={succeeded}
          errorMsg={succeeded ? null : errorMsg}
        />

        {session && !succeeded && !errorMsg && (
          <ConnectPanel
            session={session}
            pastedCode={pastedCode}
            isSubmitting={submitCode.isPending}
            onPastedCodeChange={setPastedCode}
            onSubmitCode={handleSubmitCode}
          />
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function extractError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  const maybe = err as { response?: { data?: { message?: string } } };
  return maybe?.response?.data?.message ?? fallback;
}

export { DeviceFlowModal };
export type { DeviceFlowModalProps };
