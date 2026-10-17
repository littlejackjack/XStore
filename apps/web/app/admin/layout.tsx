'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Navbar, Footer } from '@/components/nav';
import { AdminNav } from '@/components/admin-nav';
import { Spinner, Alert } from '@/components/ui';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN'))) {
      router.replace('/login?next=/admin');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <>
        <Navbar />
        <Spinner />
        <Footer />
      </>
    );
  }

  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
    return (
      <>
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 py-20">
          <Alert>Administrator access required.</Alert>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <AdminNav />
          <div className="min-w-0">{children}</div>
        </div>
      </main>
      <Footer />
    </>
  );
}
