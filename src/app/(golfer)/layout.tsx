import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";

export default async function GolferLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionContext();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-alabaster-300 bg-alabaster-100/95 text-pine backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="shrink-0 whitespace-nowrap font-sans text-lg font-bold tracking-tight text-pine">
            Golf OS
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-[13px] sm:gap-5 sm:text-sm">
            {session ? (
              <>
                {session.profile.role === "course_admin" || session.profile.role === "super_admin" ? (
                  <Link href="/admin" className="text-ink-muted transition-colors hover:text-pine">
                    Club office
                  </Link>
                ) : null}
                {session.profile.role === "caddy" ? (
                  <Link href="/caddy" className="text-ink-muted transition-colors hover:text-pine">
                    Caddie desk
                  </Link>
                ) : null}
                <Link
                  href="/bookings"
                  className={`${session.profile.role === "caddy" ? "hidden sm:inline" : ""} text-ink-muted transition-colors hover:text-pine`}
                >
                  My bookings
                </Link>
                <Link href={`/golfers/${session.profile.username}`} className="text-ink-muted transition-colors hover:text-pine">
                  Profile
                </Link>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-ink-muted transition-colors hover:text-pine">
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
