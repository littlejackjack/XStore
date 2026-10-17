'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, Spinner, Alert } from '@/components/ui';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    'site.name': '',
    'site.tagline': '',
    'site.currency': 'IDR',
    'site.supportContact': '',
    'site.registrationEnabled': true,
    'order.autoProvision': true,
    'notifications.expiryReminderDays': 3,
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    api<Record<string, unknown>>('/admin/settings')
      .then((data) => {
        setSettings(data);
        setForm({
          'site.name': String(data['site.name'] ?? 'XStore'),
          'site.tagline': String(data['site.tagline'] ?? ''),
          'site.currency': String(data['site.currency'] ?? 'IDR'),
          'site.supportContact': String(data['site.supportContact'] ?? ''),
          'site.registrationEnabled': Boolean(data['site.registrationEnabled'] ?? true),
          'order.autoProvision': Boolean(data['order.autoProvision'] ?? true),
          'notifications.expiryReminderDays': Number(data['notifications.expiryReminderDays'] ?? 3),
        });
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api('/admin/settings', { method: 'PUT', body: form });
      setMessage('Settings saved.');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      {error && <Alert>{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}

      <Card>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <div>
            <label className="label">Site name</label>
            <input className="input" value={form['site.name']} onChange={(e) => setForm({ ...form, 'site.name': e.target.value })} />
          </div>
          <div>
            <label className="label">Currency</label>
            <input className="input" value={form['site.currency']} onChange={(e) => setForm({ ...form, 'site.currency': e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Tagline</label>
            <input className="input" value={form['site.tagline']} onChange={(e) => setForm({ ...form, 'site.tagline': e.target.value })} />
          </div>
          <div>
            <label className="label">Support contact</label>
            <input className="input" value={form['site.supportContact']} onChange={(e) => setForm({ ...form, 'site.supportContact': e.target.value })} />
          </div>
          <div className="flex items-center gap-2 self-end">
            <input
              id="registration"
              type="checkbox"
              className="h-4 w-4"
              checked={form['site.registrationEnabled']}
              onChange={(e) => setForm({ ...form, 'site.registrationEnabled': e.target.checked })}
            />
            <label htmlFor="registration" className="text-sm">
              Allow new registrations
            </label>
          </div>
          <div>
            <label className="label">Expiry reminder (days before)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={30}
              value={form['notifications.expiryReminderDays']}
              onChange={(e) =>
                setForm({ ...form, 'notifications.expiryReminderDays': Number(e.target.value) || 1 })
              }
            />
            <p className="mt-1 text-xs text-zinc-500">
              Customers receive an email (Resend) this many days before their subscription expires.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
