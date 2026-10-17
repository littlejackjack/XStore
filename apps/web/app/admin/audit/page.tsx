'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export default function AdminAuditPage() {
  const [data, setData] = useState<{ items: AuditRow[]; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ items: AuditRow[]; total: number }>('/admin/audit?limit=100')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
      <p className="text-sm text-zinc-500">
        Every configuration change - API key rotations, server edits, role changes - is recorded here.
      </p>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Details</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-4 py-3 text-zinc-500">{formatDate(row.createdAt)}</td>
                <td className="px-4 py-3">
                  <Badge>{row.action}</Badge>
                </td>
                <td className="px-4 py-3">
                  {row.entity}
                  {row.entityId ? <span className="ml-1 font-mono text-xs text-zinc-400">#{row.entityId.slice(0, 8)}</span> : null}
                </td>
                <td className="px-4 py-3">{row.actorEmail ?? 'system'}</td>
                <td className="px-4 py-3">
                  <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs text-zinc-500">
                    {row.metadata ? JSON.stringify(row.metadata) : '-'}
                  </pre>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">{row.ip ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
