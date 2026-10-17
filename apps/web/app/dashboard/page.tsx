'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, endpoints } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes, formatDate, formatIdr, statusColor } from '@/lib/format';
import { Navbar, Footer } from '@/components/nav';
import { Card, Spinner, Alert, Badge, StatCard } from '@/components/ui';

interface Subscription {
  id: string;
  marzbanUsername: string;
  subscriptionUrl: string | null;
  status: string;
  product?: { id: string; name: string };
  server?: { id: string; name: string; location: string | null };
  dataLimitBytes: number | null;
  usedTrafficBytes: number;
  remainingBytes: number | null;
  expireAt: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  amountIdr: number;
  paymentUrl: string | null;
  createdAt: string;
  product?: { name: string };
  server?: { name: string };
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login?next=/dashboard');
      return;
    }
    if (!user) return;
    Promise.all([endpoints.mySubscriptions(), endpoints.myOrders()])
      .then(([subs, myOrders]) => {
        setSubscriptions(subs as Subscription[]);
        setOrders(myOrders as Order[]);
      })
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const syncUsage = async (id: string) => {
    try {
      await api(`/subscriptions/${id}/sync`, { method: 'POST' });
      const refreshed = (await endpoints.mySubscriptions()) as Subscription[];
      setSubscriptions(refreshed);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setMessage('Could not copy - please copy the link manually.');
    }
  };

  if (authLoading || loading) {
    return (
      <>
        <Navbar />
        <Spinner />
        <Footer />
      </>
    );
  }

  const activeSubscriptions = subscriptions.filter((item) => item.status === 'ACTIVE').length;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-zinc-500">Welcome back, {user?.name}.</p>
          </div>
          <Link href="/catalog" className="btn-primary">
            Buy new subscription
          </Link>
        </div>

        {message && (
          <div className="mt-4">
            <Alert>{message}</Alert>
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="Active subscriptions" value={activeSubscriptions} />
          <StatCard label="Total orders" value={orders.length} />
          <StatCard
            label="Total spent"
            value={formatIdr(
              orders
                .filter((order) => ['PAID', 'PROVISIONING', 'COMPLETED'].includes(order.status))
                .reduce((sum, order) => sum + Number(order.amountIdr), 0),
            )}
          />
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-bold">My subscriptions</h2>
          {subscriptions.length === 0 && (
            <div className="mt-4">
              <Alert type="info">
                You have no subscriptions yet. <Link href="/catalog" className="underline">Browse the catalog</Link>.
              </Alert>
            </div>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {subscriptions.map((subscription) => (
              <Card key={subscription.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{subscription.product?.name ?? 'Subscription'}</h3>
                    <p className="text-sm text-zinc-500">
                      {subscription.server?.name}
                      {subscription.server?.location ? ` · ${subscription.server.location}` : ''}
                    </p>
                  </div>
                  <Badge status={subscription.status}>{subscription.status}</Badge>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-zinc-500">Traffic used</dt>
                    <dd className="font-semibold">{formatBytes(subscription.usedTrafficBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Remaining</dt>
                    <dd className="font-semibold">{formatBytes(subscription.remainingBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Expires</dt>
                    <dd className="font-semibold">{formatDate(subscription.expireAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Username</dt>
                    <dd className="font-mono text-xs">{subscription.marzbanUsername}</dd>
                  </div>
                </dl>

                {subscription.subscriptionUrl && (
                  <div className="mt-4 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
                    <p className="text-xs text-zinc-500">Subscription URL (import into your VPN client)</p>
                    <p className="mt-1 break-all font-mono text-xs">{subscription.subscriptionUrl}</p>
                    <button
                      type="button"
                      className="btn-ghost mt-2 text-xs"
                      onClick={() => copyLink(subscription.subscriptionUrl!)}
                    >
                      {copied === subscription.subscriptionUrl ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                )}

                <button type="button" className="btn-ghost mt-3 text-xs" onClick={() => syncUsage(subscription.id)}>
                  Refresh usage
                </button>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold">Order history</h2>
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Server</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-3 font-mono text-xs">{order.orderNumber}</td>
                    <td className="px-4 py-3">{order.product?.name ?? '-'}</td>
                    <td className="px-4 py-3">{order.server?.name ?? '-'}</td>
                    <td className="px-4 py-3">{formatIdr(Number(order.amountIdr))}</td>
                    <td className="px-4 py-3">
                      <Badge status={order.status}>{order.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{formatDate(order.createdAt)}</td>
                    <td className="px-4 py-3">
                      {order.status === 'PENDING' && order.paymentUrl && (
                        <a href={order.paymentUrl} className="text-brand-600 hover:underline dark:text-brand-400">
                          Pay
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </main>
      <Footer />
    </>
  );
}
