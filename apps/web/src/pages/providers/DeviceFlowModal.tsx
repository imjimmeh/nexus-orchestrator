import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { LLMProvider } from "@/lib/api/providers.types";
import { OAuthStartResult } from "@/lib/api/common.types";
import { Clipboard, Check, Loader2, AlertCircle } from "lucide-react";

interface DeviceFlowModalProps {
  provider: LLMProvider | null;
  onClose: () => void;
}

type ModalState = "input" | "loading" | "display" | "success" | "error";

const POLL_INTERVAL_MS = 3000;

interface EnterpriseUrlInputFormProps {
  enterpriseUrl: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onInitiate: () => void;
}

function EnterpriseUrlInputForm({
  enterpriseUrl,
  onChange,
  onCancel,
  onInitiate,
}: Readonly<EnterpriseUrlInputFormProps>) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="enterprise-url">Enterprise URL (Optional)</Label>
        <Input
          id="enterprise-url"
          placeholder="company.ghe.com"
          value={enterpriseUrl}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank if using the standard github.com login.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onInitiate}>Next</Button>
      </div>
    </div>
  );
}

interface DisplayUserCodePanelProps {
  userCode: string;
  verificationUri: string;
  copied: boolean;
  onCopy: () => void;
  onCancel: () => void;
}

function DisplayUserCodePanel({
  userCode,
  verificationUri,
  copied,
  onCopy,
  onCancel,
}: Readonly<DisplayUserCodePanelProps>) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          1. Visit the activation page
        </Label>
        <div className="p-3 bg-muted rounded-md flex items-center justify-between">
          <a
            href={verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-primary underline break-all"
          >
            {verificationUri}
          </a>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">2. Enter this code</Label>
        <div className="p-4 bg-muted border border-border rounded-md flex items-center justify-between font-mono text-2xl font-bold tracking-wider justify-center">
          <span>{userCode}</span>
          <Button size="icon" variant="ghost" onClick={onCopy} className="ml-2">
            {copied ? (
              <Check className="h-5 w-5 text-success" />
            ) : (
              <Clipboard className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      <WaitingIndicator />

      <div className="flex justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface AuthCodePanelProps {
  authorizeUrl: string;
  instructions?: string;
  pastedCode: string;
  onPastedCodeChange: (value: string) => void;
  onSubmitCode: () => void;
  onCancel: () => void;
}

function AuthCodePanel({
  authorizeUrl,
  instructions,
  pastedCode,
  onPastedCodeChange,
  onSubmitCode,
  onCancel,
}: Readonly<AuthCodePanelProps>) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          1. Authorize in your browser
        </Label>
        <div className="p-3 bg-muted rounded-md">
          <a
            href={authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-primary underline break-all"
          >
            Open the authorization page
          </a>
        </div>
        {instructions && (
          <p className="text-xs text-muted-foreground">{instructions}</p>
        )}
      </div>

      <div className="space-y-2">
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

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSubmitCode} disabled={!pastedCode.trim()}>
          Submit code
        </Button>
      </div>
    </div>
  );
}

interface ConnectPanelProps {
  session: OAuthStartResult;
  copied: boolean;
  pastedCode: string;
  onCopy: () => void;
  onPastedCodeChange: (value: string) => void;
  onSubmitCode: () => void;
  onCancel: () => void;
}

function ConnectPanel({
  session,
  copied,
  pastedCode,
  onCopy,
  onPastedCodeChange,
  onSubmitCode,
  onCancel,
}: Readonly<ConnectPanelProps>) {
  if (
    session.modality === "device" &&
    session.userCode &&
    session.verificationUri
  ) {
    return (
      <DisplayUserCodePanel
        userCode={session.userCode}
        verificationUri={session.verificationUri}
        copied={copied}
        onCopy={onCopy}
        onCancel={onCancel}
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
        onCancel={onCancel}
      />
    );
  }
  return null;
}

function WaitingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center p-4 bg-primary/5 rounded-md border border-primary/10 space-y-2">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <p className="text-xs text-muted-foreground">
        Waiting for you to complete authorization in your browser...
      </p>
    </div>
  );
}

export function DeviceFlowModal({
  provider,
  onClose,
}: Readonly<DeviceFlowModalProps>) {
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState<ModalState>("input");
  const [enterpriseUrl, setEnterpriseUrl] = useState("");
  const [session, setSession] = useState<OAuthStartResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [pastedCode, setPastedCode] = useState("");
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const isCopilot =
    provider?.name?.toLowerCase().includes("copilot") ||
    provider?.runtime_env?.pi_provider === "github-copilot";

  useEffect(() => {
    if (provider && !isCopilot && modalState === "input") {
      void handleInitiate();
    }
  }, [provider]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  if (!provider) return null;

  const handleInitiate = async () => {
    setModalState("loading");
    setErrorMsg("");
    try {
      const data = await api.startProviderOAuth(
        provider.id,
        enterpriseUrl.trim() || undefined,
      );
      setSession(data);
      setModalState("display");
      startPolling(data.sessionId);
    } catch (err: unknown) {
      setErrorMsg(extractError(err, "Failed to start login"));
      setModalState("error");
    }
  };

  const startPolling = (sessionId: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await api.getProviderOAuthSessionStatus(
          provider.id,
          sessionId,
        );
        if (res.status === "connected") {
          stopPolling();
          setModalState("success");
          toast.success("Successfully authenticated!");
          void queryClient.invalidateQueries({
            queryKey: queryKeys.adminResources.providers.oauthStatus(
              provider.id,
            ),
          });
          setTimeout(onClose, 2000);
        } else if (res.status !== "pending") {
          stopPolling();
          setErrorMsg(res.error || `Authentication ${res.status}`);
          setModalState("error");
        }
      } catch (err: unknown) {
        stopPolling();
        setErrorMsg(extractError(err, "Polling status check failed"));
        setModalState("error");
      }
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const handleSubmitCode = async () => {
    if (!session || !pastedCode.trim()) return;
    try {
      await api.submitProviderOAuthCode(
        provider.id,
        session.sessionId,
        pastedCode.trim(),
      );
      toast.info("Code submitted — completing authentication...");
    } catch (err: unknown) {
      setErrorMsg(extractError(err, "Failed to submit code"));
      setModalState("error");
    }
  };

  const handleCopy = async () => {
    if (!session?.userCode) return;
    try {
      await navigator.clipboard.writeText(session.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy code to clipboard");
    }
  };

  const handleCancel = () => {
    stopPolling();
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Link {provider.name}</DialogTitle>
        </DialogHeader>

        {modalState === "input" && (
          <EnterpriseUrlInputForm
            enterpriseUrl={enterpriseUrl}
            onChange={setEnterpriseUrl}
            onCancel={handleCancel}
            onInitiate={handleInitiate}
          />
        )}

        {modalState === "loading" && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Requesting authorization...
            </p>
          </div>
        )}

        {modalState === "display" && session && (
          <ConnectPanel
            session={session}
            copied={copied}
            pastedCode={pastedCode}
            onCopy={handleCopy}
            onPastedCodeChange={setPastedCode}
            onSubmitCode={handleSubmitCode}
            onCancel={handleCancel}
          />
        )}

        {modalState === "success" && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="h-12 w-12 rounded-full bg-success/20 flex items-center justify-center">
              <Check className="h-6 w-6 text-success" />
            </div>
            <p className="text-md font-semibold">Authentication Successful</p>
            <p className="text-sm text-muted-foreground">
              Linking provider and caching keys...
            </p>
          </div>
        )}

        {modalState === "error" && (
          <div className="space-y-6 py-4">
            <div className="flex flex-col items-center justify-center space-y-3">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-md font-semibold text-destructive">
                Connection Failed
              </p>
              <p className="text-sm text-muted-foreground text-center">
                {errorMsg}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleInitiate}>Try Again</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function extractError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  const maybe = err as { response?: { data?: { message?: string } } };
  return maybe?.response?.data?.message ?? fallback;
}
