'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export default function AdminUsersPage() {
  const [data, setData] = useState<{ items: UserRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    api<{ items: UserRow[]; total: number }>('/admin/users?limit=100')
      .then(setData)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const update = async (user: UserRow, changes: Partial<UserRow>) => {
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: changes });
      setMessage('User updated.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>
      {error && <Alert>{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}
      <p className="text-sm text-zinc-500">{data.total} registered users</p>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data.items.map((user) => (
              <tr key={user.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-4 py-3 font-medium">{user.name}</td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <select
                    className="input w-auto py-1 text-xs"
                    value={user.role}
                    onChange={(event) => update(user, { role: event.target.value as UserRow['role'] })}
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <Badge status={user.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED'}>{user.status}</Badge>
                </td>
                <td className="px-4 py-3 text-zinc-500">{formatDate(user.createdAt)}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => update(user, { status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}
                  >
                    {user.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
