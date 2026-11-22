import Link from "next/link";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-alabaster-100 text-pine">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-5">
        <Link href="/" className="font-display text-2xl tracking-wide">
          Golf<span className="text-brass">·</span>OS
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">{children}</main>
    </div>
  );
}
