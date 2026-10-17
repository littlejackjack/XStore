'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatIdr } from '@/lib/format';
import { Card, Spinner, Alert, Badge, StatCard } from '@/components/ui';

interface Stats {
  totalRevenueIdr: number;
  ordersByStatus: Record<string, number>;
  last7Days: Array<{ date: string; revenueIdr: number; orders: number }>;
}

interface ServerRow {
  id: string;
  name: string;
  location: string | null;
  status: string;
  activeUsers: number;
  maxCapacity: number | null;
  remainingCapacity: number | null;
  isActive: boolean;
  lastCheckedAt: string | null;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<Stats>('/admin/stats'),
      api<ServerRow[]>('/admin/servers'),
      api<unknown[]>('/admin/orders?limit=5'),
    ])
      .then(([s, srv]) => {
        setStats(s);
        setServers(srv);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return <Alert>{error}</Alert>;
  }
  if (!stats) {
    return <Spinner />;
  }

  const onlineServers = servers.filter((server) => server.status === 'ONLINE').length;
  const totalActiveUsers = servers.reduce((sum, server) => sum + Number(server.activeUsers), 0);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Overview</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total revenue" value={formatIdr(stats.totalRevenueIdr)} hint="Paid orders only" />
        <StatCard label="Servers online" value={`${onlineServers} / ${servers.length}`} hint="Live Marzban panels" />
        <StatCard label="Active panel users" value={totalActiveUsers} hint="Across all servers" />
        <StatCard
          label="Completed orders"
          value={stats.ordersByStatus.COMPLETED ?? 0}
          hint={`${stats.ordersByStatus.PENDING ?? 0} awaiting payment`}
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold">Server monitoring</h2>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Server</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Active users</th>
                <th className="px-4 py-3 font-medium">Free slots</th>
                <th className="px-4 py-3 font-medium">Last check</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-3 font-medium">{server.name}</td>
                  <td className="px-4 py-3">{server.location ?? '-'}</td>
                  <td className="px-4 py-3">
                    <Badge status={server.status}>{server.status}</Badge>
                  </td>
                  <td className="px-4 py-3">{server.activeUsers}</td>
                  <td className="px-4 py-3">{server.remainingCapacity == null ? 'Unlimited' : server.remainingCapacity}</td>
                  <td className="px-4 py-3 text-zinc-500">
                    {server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString() : 'never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Revenue - last 7 days</h2>
        <Card className="mt-3">
          <div className="flex h-40 items-end gap-2">
            {stats.last7Days.map((day) => {
              const max = Math.max(...stats.last7Days.map((item) => item.revenueIdr), 1);
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-brand-500/80 dark:bg-brand-500/60"
                    style={{ height: `${Math.max(2, (day.revenueIdr / max) * 100)}%` }}
                    title={`${day.date}: ${formatIdr(day.revenueIdr)} (${day.orders} orders)`}
                  />
                  <span className="text-[10px] text-zinc-500">{day.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </section>
    </div>
  );
}
