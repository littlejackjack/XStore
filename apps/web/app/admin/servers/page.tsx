'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

interface Server {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  activeUsers: number;
  maxCapacity: number | null;
  remainingCapacity: number | null;
  location: string | null;
  priority: number;
  notes: string | null;
  isActive: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

const emptyForm = {
  name: '',
  baseUrl: '',
  username: '',
  password: '',
  location: '',
  priority: 0,
  maxCapacity: 0,
  notes: '',
};

export default function AdminServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState('');

  const load = () => {
    setLoading(true);
    api<Server[]>('/admin/servers')
      .then(setServers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api('/admin/servers', {
        method: 'POST',
        body: {
          ...form,
          maxCapacity: form.maxCapacity || null,
          location: form.location || undefined,
          notes: form.notes || undefined,
        },
      });
      setForm(emptyForm);
      setMessage('Server registered. The password is stored encrypted (AES-256-GCM).');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const check = async (id: string) => {
    setChecking(id);
    try {
      await api(`/admin/servers/${id}/check`, { method: 'POST' });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking('');
    }
  };

  const setStatus = async (server: Server, status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE') => {
    try {
      await api(`/admin/servers/${server.id}/status`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (server: Server) => {
    if (!confirm(`Remove server "${server.name}"?`)) return;
    try {
      await api(`/admin/servers/${server.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Marzban servers</h1>

      {error && <Alert>{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}

      <Card>
        <h2 className="font-semibold">Register a new server</h2>
        <p className="mt-1 text-sm text-zinc-500">
          The admin password is encrypted before it is stored and is never returned by the API.
        </p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={create}>
          <div>
            <label className="label">Server name</label>
            <input className="input" required placeholder="Singapore 01" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Base URL</label>
            <input
              className="input"
              required
              placeholder="https://marzban.example.com"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Admin username</label>
            <input className="input" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label className="label">Admin password</label>
            <input
              className="input"
              type="password"
              required
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Location / country</label>
            <input className="input" placeholder="Singapore" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <label className="label">Priority (lower shows first)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Max capacity (0 = unlimited)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.maxCapacity}
              onChange={(e) => setForm({ ...form, maxCapacity: Number(e.target.value) })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Internal notes</label>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full" disabled={saving}>
              {saving ? 'Saving...' : 'Add server'}
            </button>
          </div>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {servers.map((server) => (
          <Card key={server.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold">{server.name}</h3>
                <p className="text-sm text-zinc-500">{server.baseUrl}</p>
                <p className="text-sm text-zinc-500">
                  {server.location ?? 'No location'} · priority {server.priority} · user {server.username}
                </p>
              </div>
              <Badge status={server.status}>{server.status}</Badge>
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-zinc-500">Active users</dt>
                <dd className="font-semibold">{server.activeUsers}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Capacity</dt>
                <dd className="font-semibold">{server.maxCapacity ?? 'Unlimited'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Free slots</dt>
                <dd className="font-semibold">{server.remainingCapacity == null ? 'Unlimited' : server.remainingCapacity}</dd>
              </div>
            </dl>

            {server.notes && <p className="mt-3 text-xs text-zinc-500">Notes: {server.notes}</p>}
            {server.lastError && <p className="mt-1 text-xs text-rose-500">Last error: {server.lastError}</p>}
            <p className="mt-1 text-xs text-zinc-400">
              Last checked: {server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString() : 'never'}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost text-xs" disabled={checking === server.id} onClick={() => check(server.id)}>
                {checking === server.id ? 'Checking...' : 'Check status'}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setStatus(server, 'MAINTENANCE')}>
                Maintenance
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setStatus(server, 'ONLINE')}>
                Set online
              </button>
              <button type="button" className="btn-ghost text-xs text-rose-600" onClick={() => remove(server)}>
                Remove
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
