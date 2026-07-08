import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { api } from "@/lib/api/client";

const setupFormSchema = z.object({
  providerName: z.string().min(1, "Provider name is required"),
  providerBaseUrl: z.string().trim().optional(),
  secretName: z.string().trim().optional(),
  secretKeyName: z.string().trim().optional(),
  secretValue: z.string().min(1, "API key/secret value is required"),
  modelName: z.string().min(1, "Model name is required"),
  tokenLimit: z
    .string()
    .optional()
    .refine(
      (value) => !value || Number.isInteger(Number(value)),
      "Token limit must be an integer",
    ),
});

type SetupFormValues = z.infer<typeof setupFormSchema>;

interface SetupFormContentProps {
  form: UseFormReturn<SetupFormValues>;
  isLoading: boolean;
  error: string | null;
  onSubmit: (data: SetupFormValues) => Promise<void>;
  onSkip: () => Promise<void>;
}

function SetupFormContent({
  form,
  isLoading,
  error,
  onSubmit,
  onSkip,
}: Readonly<SetupFormContentProps>) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="providerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Provider name</FormLabel>
              <FormControl>
                <Input disabled={isLoading} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="providerBaseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Provider base URL</FormLabel>
              <FormControl>
                <Input disabled={isLoading} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="secretName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secret name</FormLabel>
                <FormControl>
                  <Input disabled={isLoading} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="secretKeyName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secret key name</FormLabel>
                <FormControl>
                  <Input disabled={isLoading} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="secretValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API key / secret value</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="off"
                  disabled={isLoading}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="modelName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Model name</FormLabel>
                <FormControl>
                  <Input disabled={isLoading} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tokenLimit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Token limit</FormLabel>
                <FormControl>
                  <Input disabled={isLoading} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={isLoading} className="flex-1">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Initializing...
              </>
            ) : (
              "Initialize platform setup"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={onSkip}
          >
            Skip for now
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function Setup() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupFormSchema as never),
    defaultValues: {
      providerName: "chutes.ai",
      providerBaseUrl: "https://llm.chutes.ai/v1/",
      secretName: "chutes.ai-primary",
      secretKeyName: "OPENAI_API_KEY",
      secretValue: "",
      modelName: "MiniMaxAI/MiniMax-M2.5-TEE",
      tokenLimit: "128000",
    },
  });
  const onSubmit = async (data: SetupFormValues) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.initializeSetup({
        providerName: data.providerName.trim(),
        providerBaseUrl: data.providerBaseUrl?.trim() || undefined,
        secretName: data.secretName?.trim() || undefined,
        secretKeyName: data.secretKeyName?.trim() || undefined,
        secretValue: data.secretValue.trim(),
        modelName: data.modelName.trim(),
        tokenLimit: data.tokenLimit ? Number(data.tokenLimit) : undefined,
      });

      navigate("/");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to initialize setup",
      );
    } finally {
      setIsLoading(false);
    }
  };
  const handleSkip = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await api.post("/setup/skip", {});
      navigate("/");
    } catch (skipError) {
      setError(
        skipError instanceof Error ? skipError.message : "Failed to skip setup",
      );
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Platform setup required</CardTitle>
          <CardDescription>
            Configure your first provider and model before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetupFormContent
            form={form}
            isLoading={isLoading}
            error={error}
            onSubmit={onSubmit}
            onSkip={handleSkip}
          />
        </CardContent>
      </Card>
    </div>
  );
}
