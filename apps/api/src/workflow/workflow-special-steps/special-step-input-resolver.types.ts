/**
 * Minimal contract the input resolver helpers need from a step-support
 * service. Defined structurally (no NestJS injection) so the helpers can be
 * unit-tested in isolation and reused outside the executor.
 */
export interface SpecialStepInputResolution {
  resolveJobInputs(
    template: Record<string, unknown>,
    variables: Record<string, unknown>,
  ): Record<string, unknown>;
}
