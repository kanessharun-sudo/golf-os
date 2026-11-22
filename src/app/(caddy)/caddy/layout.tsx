import { requireRole } from "@/lib/auth/session";

export default async function CaddyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["caddy"], "/caddy");

  return (
    <div className="min-h-dvh bg-pine text-alabaster">
      <header className="border-b border-pine-600">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <span className="font-display text-xl text-alabaster">
            Golf<span className="text-brass">·</span>OS <span className="text-alabaster/60">Caddie</span>
          </span>
          <div className="flex items-center gap-4 text-sm">
            <span className="numerals text-brass">{session.caddy?.caddy_code ?? "Not linked"}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="text-alabaster/70 hover:text-alabaster">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>
    </div>
  );
}
