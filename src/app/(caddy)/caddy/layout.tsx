import Link from "next/link";
import { requireRole } from "@/lib/auth/session";

export default async function CaddyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["caddy"], "/caddy");

  return (
    <div className="flex min-h-dvh flex-col bg-alabaster-100">
      <header className="sticky top-0 z-30 bg-pine text-alabaster">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Link href="/caddy" className="font-sans text-lg font-bold tracking-tight text-alabaster">
            Golf OS <span className="font-normal text-alabaster/60">Caddie desk</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="numerals rounded-full bg-alabaster/10 px-2.5 py-1 text-xs">{session.caddy?.caddy_code ?? "Not linked"}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="text-alabaster/75 hover:text-alabaster">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
