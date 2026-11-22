"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  addGalleryPhotoAction,
  deleteGalleryPhotoAction,
  saveProfileAction,
  setAvatarAction,
  type ProfileActionState,
} from "@/lib/profile/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const input = "h-11 w-full border border-alabaster-300 bg-card px-3 text-sm outline-none focus:border-pine";
const MAX_BYTES = 10 * 1024 * 1024;

export type ProfileValues = { fullName: string; bio: string; golfingSince: string; isPublic: boolean; homeCourseId: string };

export function ProfileForm({ values, courses }: { values: ProfileValues; courses: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(saveProfileAction, { ok: true, message: null });
  return (
    <form action={action} className="space-y-4 border border-alabaster-300 bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-muted">Name</span>
          <input name="fullName" defaultValue={values.fullName} required minLength={2} maxLength={80} className={input} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-muted">Playing since (year)</span>
          <input name="golfingSince" inputMode="numeric" defaultValue={values.golfingSince} maxLength={4} className={input} />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs text-ink-muted">Home club</span>
        <select name="homeCourseId" defaultValue={values.homeCourseId} className={input}>
          <option value="">None</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs text-ink-muted">About you</span>
        <textarea name="bio" defaultValue={values.bio} maxLength={400} rows={3} className="w-full border border-alabaster-300 bg-card p-3 text-sm outline-none focus:border-pine" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" defaultChecked={values.isPublic} className="size-4 accent-pine" />
        Show my profile, rounds and public photos to anyone with the link
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save profile
        </Button>
        {state.message ? <span className={state.ok ? "text-sm text-pine" : "text-sm text-destructive"}>{state.message}</span> : null}
      </div>
    </form>
  );
}

function extensionOf(file: File): string | null {
  const map: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
  return map[file.type] ?? null;
}

async function imageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    return { width: null, height: null };
  }
}

export function AvatarUpload({ userId, current, initial }: { userId: string; current: string | null; initial: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    const ext = extensionOf(file);
    if (!ext || ext === "heic" || file.size > 5 * 1024 * 1024) {
      setError("Use a JPEG, PNG or WebP photo under 5 MB.");
      return;
    }
    start(async () => {
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await getSupabaseBrowserClient().storage.from("avatars").upload(path, file, { contentType: file.type });
      if (uploadError) return setError("The upload failed. Try again.");
      const r = await setAvatarAction(path);
      if (!r.ok) return setError(r.message);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current} alt="" className="size-16 rounded-full object-cover" />
      ) : (
        <span className="grid size-16 place-items-center rounded-full bg-pine font-display text-2xl text-alabaster">{initial}</span>
      )}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <Button variant="outline" size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Change photo
      </Button>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}

export function GalleryUpload({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<"round" | "course" | "tournament" | "social">("round");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function upload() {
    if (!file) return;
    const ext = extensionOf(file);
    if (!ext || file.size > MAX_BYTES) {
      setMsg({ ok: false, text: "Use a JPEG, PNG, WebP or HEIC photo under 10 MB." });
      return;
    }
    start(async () => {
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await getSupabaseBrowserClient().storage.from("golfer-gallery").upload(path, file, { contentType: file.type });
      if (error) return setMsg({ ok: false, text: "The upload failed. Try again." });
      const size = await imageSize(file);
      const r = await addGalleryPhotoAction({ storagePath: path, caption, category, ...size });
      setMsg({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) {
        setFile(null);
        setCaption("");
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 border border-alabaster-300 bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr]">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:h-11 file:border-0 file:bg-pine-50 file:px-4 file:text-pine"
        />
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" maxLength={200} className={input} />
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={input}>
          <option value="round">Round</option>
          <option value="course">Course</option>
          <option value="tournament">Tournament</option>
          <option value="social">Social</option>
        </select>
      </div>
      <Button disabled={!file || pending} onClick={upload}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Add photo
      </Button>
      {msg ? <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice> : null}
    </div>
  );
}

export function DeletePhoto({ photoId }: { photoId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="shrink-0 text-destructive underline-offset-4 hover:underline disabled:opacity-50"
      onClick={() =>
        start(async () => {
          const r = await deleteGalleryPhotoAction(photoId);
          if (r.ok) router.refresh();
        })
      }
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
