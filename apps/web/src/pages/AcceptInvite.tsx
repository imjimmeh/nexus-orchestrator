// apps/web/src/pages/AcceptInvite.tsx
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useAcceptInvitation } from "@/hooks/useAcceptInvitation";
import { useAuthStore } from "@/stores/auth.store";
import type { AcceptInvitationResult } from "@/lib/api/client.invitations.types";

// Mirrors the backend's uniform error response for invitation acceptance —
// never surface the underlying error detail (avoids leaking whether a token
// exists, is expired, or is malformed).
const INVALID_INVITATION_MESSAGE = "This invitation is invalid or has expired.";
const MISSING_TOKEN_MESSAGE =
  "This invitation link is missing a token. Please use the link from your invitation email.";

const acceptInviteFormSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type AcceptInviteFormValues = z.infer<typeof acceptInviteFormSchema>;

interface AnonymousAcceptFormProps {
  isPending: boolean;
  onSubmit: (values: AcceptInviteFormValues) => void;
}

function AnonymousAcceptForm({
  isPending,
  onSubmit,
}: Readonly<AnonymousAcceptFormProps>) {
  const form = useForm<AcceptInviteFormValues>({
    resolver: zodResolver(acceptInviteFormSchema),
    defaultValues: { username: "", password: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input
                  placeholder="Choose a username"
                  autoComplete="username"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="Choose a password"
                  autoComplete="new-password"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Accepting...
            </>
          ) : (
            "Accept invitation"
          )}
        </Button>
      </form>
    </Form>
  );
}

interface LoggedInAcceptButtonProps {
  isPending: boolean;
  onAccept: () => void;
}

function LoggedInAcceptButton({
  isPending,
  onAccept,
}: Readonly<LoggedInAcceptButtonProps>) {
  return (
    <Button className="w-full" disabled={isPending} onClick={onAccept}>
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Accepting...
        </>
      ) : (
        "Accept invitation"
      )}
    </Button>
  );
}

export function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setSession = useAuthStore((state) => state.setSession);
  const acceptInvitation = useAcceptInvitation();
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = (result: AcceptInvitationResult) => {
    setSession(result);
    navigate("/");
  };

  const handleError = () => {
    setError(INVALID_INVITATION_MESSAGE);
  };

  const acceptWithCredentials = (credentials?: {
    username: string;
    password: string;
  }) => {
    if (!token) {
      return;
    }

    setError(null);
    acceptInvitation.mutate(
      { token, ...credentials },
      { onSuccess: handleSuccess, onError: handleError },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Accept invitation</CardTitle>
          <CardDescription>
            {isAuthenticated
              ? "Join this scope with your current account."
              : "Create your account to join this scope."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {MISSING_TOKEN_MESSAGE}
            </div>
          ) : (
            <>
              {isAuthenticated ? (
                <LoggedInAcceptButton
                  isPending={acceptInvitation.isPending}
                  onAccept={() => acceptWithCredentials()}
                />
              ) : (
                <AnonymousAcceptForm
                  isPending={acceptInvitation.isPending}
                  onSubmit={(values) => acceptWithCredentials(values)}
                />
              )}

              {error && (
                <div className="mt-4 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
