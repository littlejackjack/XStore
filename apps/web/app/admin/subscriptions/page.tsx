'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

interface Subscription {
  id: string;
  marzbanUsername: string;
  status: string;
  userEmail?: string;
  product?: { name: string };
  server?: { name: string };
  dataLimitBytes: number | null;
  usedTrafficBytes: number;
  expireAt: string | null;
}

export default function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Subscription[]>('/admin/subscriptions')
      .then(setSubscriptions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Panel user</th>
              <th className="px-4 py-3 font-medium">Used</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((subscription) => (
              <tr key={subscription.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-4 py-3">{subscription.userEmail ?? '-'}</td>
                <td className="px-4 py-3">{subscription.product?.name ?? '-'}</td>
                <td className="px-4 py-3">{subscription.server?.name ?? '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{subscription.marzbanUsername}</td>
                <td className="px-4 py-3">
                  {formatBytes(subscription.usedTrafficBytes)} / {formatBytes(subscription.dataLimitBytes)}
                </td>
                <td className="px-4 py-3 text-zinc-500">{formatDate(subscription.expireAt)}</td>
                <td className="px-4 py-3">
                  <Badge status={subscription.status}>{subscription.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
