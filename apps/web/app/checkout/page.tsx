'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, endpoints, type AvailableServer, type Product } from '@/lib/api';
import { formatIdr } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Navbar, Footer } from '@/components/nav';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

function CheckoutInner() {
  const params = useSearchParams();
  const productId = params.get('product') ?? '';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [servers, setServers] = useState<AvailableServer[]>([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=/checkout?product=${productId}`);
      return;
    }
    if (!productId) return;

    Promise.all([endpoints.products(), endpoints.serversAvailable()])
      .then(([products, available]) => {
        setProduct(products.find((item) => item.id === productId) ?? null);
        setServers(available);
        if (available.length > 0) setSelectedServer(available[0].id);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [productId, user, authLoading, router]);

  const submit = async () => {
    if (!selectedServer) {
      setError('Please choose a server.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await api<{ paymentUrl: string }>('/orders', {
        method: 'POST',
        body: { productId, serverId: selectedServer },
      });
      // Hand the buyer over to the Bayar.gg hosted checkout page.
      window.location.href = result.paymentUrl;
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <>
        <Navbar />
        <Spinner />
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Server selection */}
          <div>
            <h2 className="text-lg font-semibold">1. Choose your server</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Live status and capacity are refreshed by our monitoring worker.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {servers.map((server) => (
                <button
                  type="button"
                  key={server.id}
                  onClick={() => setSelectedServer(server.id)}
                  className={`card text-left transition ${
                    selectedServer === server.id
                      ? 'border-brand-500 ring-2 ring-brand-500/40'
                      : 'hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{server.name}</p>
                      <p className="text-sm text-zinc-500">{server.location ?? 'Unknown location'}</p>
                    </div>
                    <Badge status={server.status}>{server.status}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-zinc-500">Active users</dt>
                      <dd className="font-semibold">{server.activeUsers}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Free slots</dt>
                      <dd className="font-semibold">
                        {server.remainingCapacity == null ? 'Unlimited' : server.remainingCapacity}
                      </dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
            {servers.length === 0 && (
              <Alert type="info">No servers are currently available. Please try again later.</Alert>
            )}
          </div>

          {/* Order summary */}
          <Card className="h-fit lg:sticky lg:top-24">
            <h2 className="text-lg font-semibold">2. Order summary</h2>
            {product ? (
              <>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-zinc-500">{product.name}</span>
                  <span className="font-semibold">{formatIdr(Number(product.priceIdr))}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-zinc-500">
                  <span>Duration</span>
                  <span>{product.durationDays} days</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-zinc-500">
                  <span>Traffic</span>
                  <span>{product.dataLimitGb ? `${product.dataLimitGb} GB` : 'Unlimited'}</span>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
                  <span>Server</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {servers.find((item) => item.id === selectedServer)?.name ?? '-'}
                  </span>
                </div>
                <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-brand-600 dark:text-brand-400">{formatIdr(Number(product.priceIdr))}</span>
                  </div>
                  <button type="button" className="btn-primary mt-4 w-full py-3" disabled={submitting || !selectedServer} onClick={submit}>
                    {submitting ? 'Redirecting to payment...' : 'Pay now with Bayar.gg'}
                  </button>
                  <p className="mt-3 text-center text-xs text-zinc-500">
                    Your account is created automatically after the payment is confirmed.
                  </p>
                </div>
              </>
            ) : (
              <Alert>Product not found. Please go back to the catalog.</Alert>
            )}
          </Card>
        </div>
      </main>
      <Footer />
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <>
          <Navbar />
          <Spinner />
          <Footer />
        </>
      }
    >
      <CheckoutInner />
    </Suspense>
  );
}
