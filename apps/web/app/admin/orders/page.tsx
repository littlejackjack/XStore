'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatIdr } from '@/lib/format';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  amountIdr: number;
  paymentUrl: string | null;
  bayarInvoiceId: string | null;
  failureReason: string | null;
  createdAt: string;
  product?: { name: string };
  server?: { name: string };
  user?: { email: string };
}

export default function AdminOrdersPage() {
  const [data, setData] = useState<{ items: Order[]; total: number } | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api<{ items: Order[]; total: number }>('/admin/orders?limit=50')
      .then(setData)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
      <p className="text-sm text-zinc-500">{data.total} total orders</p>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((order) => (
              <tr key={order.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-4 py-3 font-mono text-xs">{order.orderNumber}</td>
                <td className="px-4 py-3">{order.user?.email ?? '-'}</td>
                <td className="px-4 py-3">{order.product?.name ?? '-'}</td>
                <td className="px-4 py-3">{order.server?.name ?? '-'}</td>
                <td className="px-4 py-3">{formatIdr(Number(order.amountIdr))}</td>
                <td className="px-4 py-3">
                  <Badge status={order.status}>{order.status}</Badge>
                  {order.failureReason && <p className="mt-1 text-xs text-rose-500">{order.failureReason}</p>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500">{order.bayarInvoiceId ?? '-'}</td>
                <td className="px-4 py-3 text-zinc-500">{formatDate(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
