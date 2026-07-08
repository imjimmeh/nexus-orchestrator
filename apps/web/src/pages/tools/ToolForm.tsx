import { useForm, type UseFormReturn } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tool } from "@/lib/api/tools.types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  language: z.enum(["node", "python"]),
  schema: z.string().min(1, "Schema JSON is required"),
  typescript_code: z.string().min(1, "TypeScript code is required"),
  tier_restriction: z.enum(["1", "2"]),
});

type FormData = z.infer<typeof formSchema>;

interface ToolFormProps {
  tool?: Tool;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

interface ToolFormBodyProps {
  form: UseFormReturn<FormData>;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}

function getToolSubmitLabel(isSubmitting: boolean, tool?: Tool): string {
  if (isSubmitting) {
    return "Saving...";
  }

  return tool ? "Update" : "Create";
}

function buildToolDefaults(tool?: Tool): FormData {
  return {
    name: tool?.name || "",
    language: tool?.language || "node",
    schema: tool?.schema
      ? JSON.stringify(tool.schema, null, 2)
      : '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
    typescript_code:
      tool?.typescript_code ||
      "export const tool = {\n  execute: async (params: Record<string, unknown>) => {\n    return { ok: true };\n  },\n};",
    tier_restriction: String(tool?.tier_restriction || 1) as "1" | "2",
  };
}

function ToolFormBody({
  form,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
}: Readonly<ToolFormBodyProps>) {
  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., github_merge_pr" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Language</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="node">node</SelectItem>
                  <SelectItem value="python">python</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tier_restriction"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tier Restriction</FormLabel>
              <FormControl>
                <Input {...field} placeholder="1 or 2" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="schema"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Schema (JSON)</FormLabel>
              <FormControl>
                <Textarea className="font-mono min-h-[120px]" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="typescript_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>TypeScript Code</FormLabel>
              <FormControl>
                <Textarea className="font-mono min-h-[220px]" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function ToolForm({
  tool,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<ToolFormProps>) {
  const submitLabel = getToolSubmitLabel(isSubmitting, tool);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema as never),
    defaultValues: buildToolDefaults(tool),
  });

  return (
    <ToolFormBody
      form={form}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isSubmitting={isSubmitting}
      submitLabel={submitLabel}
    />
  );
}
