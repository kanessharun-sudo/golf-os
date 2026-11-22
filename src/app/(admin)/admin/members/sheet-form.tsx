"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { saveMemberSheetAction, syncMembersNowAction, type AdminActionState } from "@/lib/admin/actions";

const INITIAL: AdminActionState = { ok: true, message: null };

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function SheetForm({ courseId, sheetUrl }: { courseId: string; sheetUrl: string | null }) {
  const [saveState, saveAction] = useActionState(saveMemberSheetAction, INITIAL);
  const [syncState, syncAction] = useActionState(syncMembersNowAction, INITIAL);
  const state = syncState.message ? syncState : saveState;

  return (
    <div className="space-y-4">
      <form action={saveAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="courseId" value={courseId} />
        <input
          name="sheetUrl"
          type="url"
          defaultValue={sheetUrl ?? ""}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="h-11 min-w-0 flex-1 border border-alabaster-300 bg-card px-3 text-sm outline-none focus:border-pine"
        />
        <Submit>Save link</Submit>
      </form>
      <form action={syncAction}>
        <input type="hidden" name="courseId" value={courseId} />
        <Submit variant="outline">
          <RefreshCw /> Sync now
        </Submit>
      </form>
      {state.message ? <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice> : null}
    </div>
  );
}
