import type { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";

interface ToastedMutationOptions<TResult> {
  errorTitle: string;
  errorFallback: string;
  onSuccess: (result: TResult) => void;
}

/**
 * Runs a mutation and reports its outcome via toast: the caller-supplied
 * `onSuccess` handler on resolve, or a standardized error toast (using the
 * shared API error message extractor) on rejection.
 *
 * Centralizes the try/catch + toast wiring shared by every learning
 * candidate/proposal mutation (reject, archive, approve, bulk-*) so none of
 * them can silently discard a failed `mutateAsync` call.
 */
export async function runToastedMutation<TResult>(
  toast: ReturnType<typeof useToast>,
  action: () => Promise<TResult>,
  options: ToastedMutationOptions<TResult>,
): Promise<void> {
  try {
    const result = await action();
    options.onSuccess(result);
  } catch (error) {
    toast.error(
      options.errorTitle,
      getApiErrorMessage(error, options.errorFallback),
    );
  }
}
