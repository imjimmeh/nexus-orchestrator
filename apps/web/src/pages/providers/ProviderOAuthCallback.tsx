import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCompleteProviderOAuthCallback } from "@/hooks/useProviders";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ProviderOAuthCallback() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const completeMutation = useCompleteProviderOAuthCallback();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (code && state && !submittedRef.current) {
      submittedRef.current = true;
      completeMutation.mutate({ code, state });
    }
  }, [code, state, completeMutation]);

  if (!code || !state) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <h2 className="text-xl font-semibold">Invalid Request</h2>
        <p className="text-muted-foreground">
          Missing authorization parameters. Please try connecting again from the
          providers page.
        </p>
        <Button asChild>
          <Link to="/providers">Back to Providers</Link>
        </Button>
      </div>
    );
  }

  if (completeMutation.isPending || !submittedRef.current) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-muted-foreground">
          Completing OAuth authorization...
        </p>
      </div>
    );
  }

  if (completeMutation.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <h2 className="text-xl font-semibold text-destructive">OAuth Error</h2>
        <p className="text-muted-foreground">
          {completeMutation.error?.message ??
            "Failed to complete OAuth authorization. Please try again."}
        </p>
        <Button asChild>
          <Link to="/providers">Back to Providers</Link>
        </Button>
      </div>
    );
  }

  if (completeMutation.isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <h2 className="text-xl font-semibold text-success">
          OAuth Connected Successfully
        </h2>
        <p className="text-muted-foreground">
          Your provider has been authorized. You can now use it in your
          configurations.
        </p>
        <Button asChild>
          <Link to="/providers">Back to Providers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="text-muted-foreground">Completing OAuth authorization...</p>
    </div>
  );
}
