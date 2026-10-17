'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatIdr } from '@/lib/format';
import { Card, Spinner, Alert, Badge } from '@/components/ui';

interface Product {
  id: string;
  name: string;
  slug: string;
  priceIdr: number;
  durationDays: number;
  dataLimitGb: number | null;
  isActive: boolean;
}

const emptyForm = { name: '', slug: '', description: '', priceIdr: 25000, durationDays: 30, dataLimitGb: 50 };

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api<Product[]>('/admin/products')
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api('/admin/products', {
        method: 'POST',
        body: { ...form, dataLimitGb: form.dataLimitGb || null },
      });
      setForm(emptyForm);
      setMessage('Product created.');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product: Product) => {
    try {
      await api(`/admin/products/${product.id}`, { method: 'PUT', body: { isActive: !product.isActive } });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (product: Product) => {
    if (!confirm(`Delete "${product.name}"?`)) return;
    try {
      await api(`/admin/products/${product.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Products</h1>

      {error && <Alert>{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}

      <Card>
        <h2 className="font-semibold">Add product</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={create}>
          <div>
            <label className="label">Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Slug</label>
            <input className="input" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </div>
          <div>
            <label className="label">Price (IDR)</label>
            <input
              className="input"
              type="number"
              min={1000}
              required
              value={form.priceIdr}
              onChange={(e) => setForm({ ...form, priceIdr: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Duration (days)</label>
            <input
              className="input"
              type="number"
              min={1}
              required
              value={form.durationDays}
              onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Data limit (GB, 0 = unlimited)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.dataLimitGb}
              onChange={(e) => setForm({ ...form, dataLimitGb: Number(e.target.value) })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Create product'}
            </button>
          </div>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Traffic</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-4 py-3 font-medium">{product.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500">{product.slug}</td>
                <td className="px-4 py-3">{formatIdr(Number(product.priceIdr))}</td>
                <td className="px-4 py-3">{product.durationDays} days</td>
                <td className="px-4 py-3">{product.dataLimitGb ? `${product.dataLimitGb} GB` : 'Unlimited'}</td>
                <td className="px-4 py-3">
                  <Badge status={product.isActive ? 'ACTIVE' : 'DISABLED'}>{product.isActive ? 'ACTIVE' : 'HIDDEN'}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button type="button" className="btn-ghost text-xs" onClick={() => toggleActive(product)}>
                      {product.isActive ? 'Hide' : 'Show'}
                    </button>
                    <button type="button" className="btn-ghost text-xs text-rose-600" onClick={() => remove(product)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
