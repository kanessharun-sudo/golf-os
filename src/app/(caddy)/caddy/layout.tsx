import { requireRole } from "@/lib/auth/session";

export default async function CaddyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["caddy"], "/caddy");

  return (
    <div className="min-h-dvh bg-pine text-alabaster">
      <header className="border-b border-pine-600">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <span className="font-display text-xl text-alabaster">Caddy Desk</span>
          <span className="numerals text-eyebrow uppercase text-brass">{session.caddy?.caddy_code ?? "Unlinked"}</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>
    </div>
  );
}
