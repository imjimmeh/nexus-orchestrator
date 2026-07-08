import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Secret } from "@/lib/api/secrets.types";
import { Check, X } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  value: z.string().min(1, "Value is required"),
});

type FormData = z.infer<typeof formSchema>;

interface SecretFormProps {
  secret?: Secret;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function SecretForm({
  secret,
  onSubmit,
  onCancel,
  isSubmitting,
}: SecretFormProps) {
  const [isJsonValid, setIsJsonValid] = useState(true);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      name: secret?.name || "",
      value: secret?.metadata ? JSON.stringify(secret.metadata, null, 2) : "",
    },
  });

  const valueField = form.watch("value");

  useEffect(() => {
    if (!valueField) {
      setIsJsonValid(true);
      return;
    }

    try {
      JSON.parse(valueField);
      setIsJsonValid(true);
    } catch {
      setIsJsonValid(false);
    }
  }, [valueField]);

  const handleSubmit = (data: FormData) => {
    if (!isJsonValid) return;
    onSubmit(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., OpenAI API Key" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Value (JSON format)
                {isJsonValid ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check className="h-3 w-3" />
                    Valid JSON
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <X className="h-3 w-3" />
                    Invalid JSON
                  </span>
                )}
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder='{"OPENAI_API_KEY": "sk-..."}'
                  className="font-mono min-h-[150px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
              <p className="text-xs text-muted-foreground">
                Enter valid JSON. Example: {"{"} "KEY": "value" {"}"}
              </p>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || !isJsonValid}>
            {isSubmitting ? "Saving..." : secret ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
