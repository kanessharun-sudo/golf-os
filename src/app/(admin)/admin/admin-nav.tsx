"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Tee sheet" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/caddies", label: "Caddies" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 text-sm" aria-label="Club office">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2.5 transition-colors",
              active ? "border-brass text-alabaster" : "border-transparent text-alabaster/65 hover:text-alabaster",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
