import { forwardRef, type HTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "./utils.js";

/* Extracted from `.vault-field`/`.vault-checkbox-field` (docs/adr/0005) — the
 * labelled-input row used by the vault gate, backup restore and the account
 * sign-in form. `[&>label]`/`[&>input]` are direct-child matches, mirroring
 * the original `.vault-field label`/`.vault-field input` descendant rules,
 * which in this markup are always the field's own immediate children. */
const FIELD_BASE =
  "flex flex-col gap-[var(--sp-1)] mb-[var(--sp-3)] [&>label]:text-muted [&>input]:w-full";

export type FieldProps = HTMLAttributes<HTMLDivElement>;

const Field = forwardRef<HTMLDivElement, FieldProps>(function Field({ className, ...props }, ref) {
  return <div ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
});

/* `mt-`/`mb-` as two separate utilities, not `my-`+`mb-`: `my-*` sets both
 * margin-top and margin-bottom in one Tailwind rule, and `cn()`'s `twMerge`
 * drops a whole conflicting utility rather than merging by property — so
 * `my-2 mb-4` would have dropped `my-2` entirely, losing its margin-top too. */
const CHECKBOX_FIELD_BASE =
  "flex items-center gap-[var(--sp-2)] mt-[var(--sp-2)] mb-[var(--sp-4)] text-ink";

export type CheckboxFieldProps = LabelHTMLAttributes<HTMLLabelElement> & {
  "data-testid"?: string;
};

/* data-testid, not the removed `.vault-checkbox-field` class: one test
 * (VaultGate.setup.test.tsx) scoped a `querySelector` to it to find the one
 * checkbox in the setup form. */
const CheckboxField = forwardRef<HTMLLabelElement, CheckboxFieldProps>(function CheckboxField(
  { className, "data-testid": dataTestId, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      data-testid={dataTestId ?? "vault-checkbox-field"}
      className={cn(CHECKBOX_FIELD_BASE, className)}
      {...props}
    />
  );
});

export { Field, CheckboxField };
export default Field;
