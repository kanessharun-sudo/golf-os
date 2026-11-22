"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function Field({
  label,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs text-ink-muted">{label}</span>
      <input
        {...props}
        className="h-11 w-full border border-alabaster-300 bg-card px-3 text-sm outline-none focus:border-pine disabled:opacity-60"
      />
      {hint ? <span className="block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}
