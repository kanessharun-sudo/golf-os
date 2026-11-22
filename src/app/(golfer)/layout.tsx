import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";

export default async function GolferLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionContext();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-pine text-alabaster">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="shrink-0 whitespace-nowrap font-sans text-lg font-bold tracking-tight text-alabaster">
            Golf OS
          </Link>
          <nav className="flex items-center gap-3 whitespace-nowrap text-[13px] sm:gap-5 sm:text-sm">
            {session ? (
              <>
                {session.profile.role === "course_admin" || session.profile.role === "super_admin" ? (
                  <Link href="/admin" className="text-alabaster/80 transition-colors hover:text-alabaster">
                    Club office
                  </Link>
                ) : null}
                {session.profile.role === "caddy" ? (
                  <Link href="/caddy" className="text-alabaster/80 transition-colors hover:text-alabaster">
                    Caddie desk
                  </Link>
                ) : null}
                <Link
                  href="/bookings"
                  className={`${session.profile.role === "caddy" ? "hidden sm:inline" : ""} text-alabaster/80 transition-colors hover:text-alabaster`}
                >
                  My bookings
                </Link>
                <Link href={`/golfers/${session.profile.username}`} className="text-alabaster/80 transition-colors hover:text-alabaster">
                  Profile
                </Link>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-alabaster/60 transition-colors hover:text-alabaster">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/login" className="text-alabaster underline-offset-4 hover:underline">
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
