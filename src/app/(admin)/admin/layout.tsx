import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["course_admin", "super_admin"], "/admin");

  return (
    <div className="min-h-dvh bg-alabaster-100">
      <header className="bg-pine text-alabaster">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <span className="font-display text-xl">Golf OS · Administration</span>
          <span className="text-eyebrow uppercase text-brass">
            {session.profile.role === "super_admin" ? "Super admin" : `${session.adminCourseIds.length} course(s)`}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
    </div>
  );
}
