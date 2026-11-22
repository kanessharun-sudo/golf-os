import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["course_admin", "super_admin"], "/admin");

  return (
    <div className="min-h-dvh bg-alabaster-100">
      <header className="border-b border-alabaster-300 bg-alabaster-50 text-pine">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3">
          <Link href="/admin" className="font-display text-xl text-pine">
            Golf<span className="text-brass">·</span>OS <span className="text-ink-muted">Club office</span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <span className="hidden text-ink-muted sm:inline">{session.profile.full_name}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="text-ink-muted hover:text-pine">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:py-10">{children}</main>
    </div>
  );
}
