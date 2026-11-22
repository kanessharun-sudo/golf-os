import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";

export default async function GolferLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionContext();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-alabaster-300/70 bg-alabaster-50/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="font-display text-2xl tracking-wide text-pine">
            Golf<span className="text-brass">·</span>OS
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {session ? (
              <>
                <Link href="/bookings" className="text-ink-muted transition-colors hover:text-pine">
                  My bookings
                </Link>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-ink-faint transition-colors hover:text-pine">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/login" className="text-pine underline-offset-4 hover:underline">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-alabaster-300/70">
        <div className="mx-auto max-w-6xl px-5 py-8 text-eyebrow uppercase text-ink-faint">
          Tee times · Live scoring · Caddies
        </div>
      </footer>
    </div>
  );
}
