import { PolicyFormNullableNumberField } from "./PolicyFormInputs";
import type { PolicyFormSectionProps } from "./PolicyForm.hooks.types";

export function PolicyFormLimitsSection({
  control,
}: Readonly<PolicyFormSectionProps>) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <PolicyFormNullableNumberField
        control={control}
        name="soft_limit_cents"
        label="Soft Limit (cents)"
      />
      <PolicyFormNullableNumberField
        control={control}
        name="hard_limit_cents"
        label="Hard Limit (cents)"
      />
      <PolicyFormNullableNumberField
        control={control}
        name="token_limit"
        label="Token Limit"
      />
    </div>
  );
}
