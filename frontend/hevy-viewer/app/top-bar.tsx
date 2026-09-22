"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logoutFromBackend } from "./exercises/api";
import { clearCachedCredentials, readCachedCredentials } from "./exercises/auth-cache";

const LINKS = [
  { href: "/routines", label: "Routines" },
  { href: "/program", label: "Program" },
  { href: "/exercises", label: "Exercises" },
  { href: "/prs", label: "Records" },
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
];

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();

  function logout(): void {
    const session = readCachedCredentials();
    clearCachedCredentials();
    if (session) void logoutFromBackend(session);
    router.push("/login");
  }

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <Link href="/" className="text-lg font-semibold tracking-tight" aria-current={pathname === "/" ? "page" : undefined}>Hevy Viewer</Link>
      <nav className="flex flex-wrap items-center gap-3">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="control-button" aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>
        ))}
        <button type="button" onClick={logout} className="control-button">Log out</button>
      </nav>
    </header>
  );
}
