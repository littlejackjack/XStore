'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from './theme-toggle';

export function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">X</span>
          XStore
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/">Home</NavLink>
          <NavLink href="/catalog">Catalog</NavLink>
          {user && <NavLink href="/dashboard">Dashboard</NavLink>}
          {user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
            <NavLink href="/admin">Admin</NavLink>
          )}
          <ThemeToggle />
          {user ? (
            <button type="button" onClick={handleLogout} className="btn-ghost ml-2">
              Logout
            </button>
          ) : (
            <Link href="/login" className="btn-primary ml-2">
              Login
            </Link>
          )}
        </nav>

        <button type="button" className="btn-ghost md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          ☰
        </button>
      </div>

      {open && (
        <div className="border-t border-zinc-200 px-4 py-3 md:hidden dark:border-zinc-800">
          <div className="flex flex-col gap-2">
            <NavLink href="/">Home</NavLink>
            <NavLink href="/catalog">Catalog</NavLink>
            {user && <NavLink href="/dashboard">Dashboard</NavLink>}
            {user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && <NavLink href="/admin">Admin</NavLink>}
            {!user && <NavLink href="/login">Login</NavLink>}
            {user && (
              <button type="button" onClick={handleLogout} className="btn-ghost">
                Logout
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      {children}
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4">
        <p>
          XStore - secure subscription platform. Payments via Bayar.gg, delivery via Marzban, email via Resend.
        </p>
        <p className="mt-1">All credentials are encrypted at rest. Never share your subscription link.</p>
      </div>
    </footer>
  );
}
