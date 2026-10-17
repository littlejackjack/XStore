'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, Spinner, Alert } from '@/components/ui';

interface ApiKeyRow {
  provider: 'RESEND' | 'BAYARGG';
  configured: boolean;
  maskedKey: string | null;
  maskedWebhookSecret: string | null;
  lastUpdatedByEmail: string | null;
  updatedAt: string | null;
}

const PROVIDER_INFO: Record<string, { title: string; docs: string; webhook: boolean; hint: string }> = {
  BAYARGG: {
    title: 'Bayar.gg (payments)',
    docs: 'https://www.bayar.gg/api-docs',
    webhook: true,
    hint: 'API Key from your Bayar.gg dashboard. The webhook secret (whsec_...) comes from Developer -> Webhook & Callback.',
  },
  RESEND: {
    title: 'Resend (email)',
    docs: 'https://resend.com/docs',
    webhook: false,
    hint: 'API Key used to send transactional emails (subscription delivery).',
  },
};

export default function AdminApiKeysPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; webhookSecret: string }>>({});
  const [saving, setSaving] = useState('');

  const load = () => {
    setLoading(true);
    api<ApiKeyRow[]>('/admin/api-keys')
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const save = async (provider: string) => {
    const draft = drafts[provider] ?? { apiKey: '', webhookSecret: '' };
    if (!draft.apiKey && !draft.webhookSecret) return;
    setSaving(provider);
    setMessage('');
    try {
      await api(`/admin/api-keys/${provider}`, {
        method: 'PUT',
        body: { apiKey: draft.apiKey || undefined, webhookSecret: draft.webhookSecret || undefined },
      });
      setDrafts((previous) => ({ ...previous, [provider]: { apiKey: '', webhookSecret: '' } }));
      setMessage(`${provider} credentials updated and encrypted.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving('');
    }
  };

  const verify = async (provider: string) => {
    try {
      const result = await api<{ verified: boolean; status: number }>(`/admin/api-keys/${provider}/verify`, {
        method: 'POST',
      });
      setMessage(result.verified ? `${provider} key verified successfully.` : `${provider} verification failed (HTTP ${result.status}).`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">API keys</h1>

      {!isSuperAdmin && (
        <Alert type="info">Only Super Admins can rotate API keys. You can view the configuration status.</Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}

      <Alert type="info">
        Keys are encrypted with AES-256-GCM before being written to the database, cached in Redis for 60 seconds and
        never exposed to the browser. Every change is written to the audit log.
      </Alert>

      {rows.map((row) => {
        const info = PROVIDER_INFO[row.provider];
        return (
          <Card key={row.provider}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">{info.title}</h2>
                <p className="mt-1 text-sm text-zinc-500">{info.hint}</p>
                <a href={info.docs} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
                  API documentation ↗
                </a>
              </div>
              <span className={`badge ${row.configured ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                {row.configured ? 'Configured' : 'Not configured'}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-zinc-500">Current key</dt>
                <dd className="font-mono">{row.maskedKey ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Webhook secret</dt>
                <dd className="font-mono">{row.maskedWebhookSecret ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Last updated</dt>
                <dd>
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}
                  {row.lastUpdatedByEmail ? ` by ${row.lastUpdatedByEmail}` : ''}
                </dd>
              </div>
            </dl>

            {isSuperAdmin && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">New API key (leave blank to keep)</label>
                  <input
                    className="input font-mono"
                    type="password"
                    autoComplete="off"
                    placeholder="pk_live_..."
                    value={drafts[row.provider]?.apiKey ?? ''}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [row.provider]: {
                          apiKey: event.target.value,
                          webhookSecret: previous[row.provider]?.webhookSecret ?? '',
                        },
                      }))
                    }
                  />
                </div>
                {info.webhook && (
                  <div>
                    <label className="label">Webhook secret (whsec_...)</label>
                    <input
                      className="input font-mono"
                      type="password"
                      autoComplete="off"
                      placeholder="whsec_..."
                      value={drafts[row.provider]?.webhookSecret ?? ''}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [row.provider]: {
                            apiKey: previous[row.provider]?.apiKey ?? '',
                            webhookSecret: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                )}
                <div className="flex gap-2 sm:col-span-2">
                  <button type="button" className="btn-primary" disabled={saving === row.provider} onClick={() => save(row.provider)}>
                    {saving === row.provider ? 'Saving...' : 'Save encrypted'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => verify(row.provider)}>
                    Verify
                  </button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
