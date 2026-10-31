"use client";

import { useFormStatus } from "react-dom";

/** Submit button that disables itself while its form's action runs. */
export function PendingButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="pill pill-primary w-full disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled || pending} aria-disabled={disabled || pending}>
      {pending ? "Working…" : children}
    </button>
  );
}
