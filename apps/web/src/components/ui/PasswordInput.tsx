import { useState, type InputHTMLAttributes } from "react";

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  showLabel: string;
  hideLabel: string;
};

/* A typed password the person cannot see is the most common reason a fresh
 * account fails its first sign-in. The toggle is `type="button"` so it never
 * submits the form it sits in. */
export default function PasswordInput({ showLabel, hideLabel, ...input }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...input} type={visible ? "text" : "password"} className="w-full pr-16" />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent! border-0! p-1! text-[0.85rem] text-muted underline cursor-pointer"
        aria-pressed={visible}
        aria-controls={input.id}
        disabled={input.disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? hideLabel : showLabel}
      </button>
    </div>
  );
}
