'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { endpoints, type Product } from '@/lib/api';
import { formatIdr } from '@/lib/format';
import { Navbar, Footer } from '@/components/nav';
import { Card, Spinner, Alert } from '@/components/ui';

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    endpoints
      .products()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Subscription packages</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          All packages work on every server. You choose the server at checkout.
        </p>

        {loading && <Spinner label="Loading packages..." />}
        {error && <Alert>{error}</Alert>}

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {products.map((product) => (
            <Card key={product.id} className="flex flex-col">
              <h2 className="text-xl font-bold">{product.name}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {product.durationDays} days · {product.dataLimitGb ? `${product.dataLimitGb} GB` : 'Unlimited traffic'}
              </p>
              <p className="mt-4 text-3xl font-extrabold text-brand-600 dark:text-brand-400">
                {formatIdr(Number(product.priceIdr))}
              </p>
              {product.description && (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{product.description}</p>
              )}
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {(product.features ?? []).map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span className="text-emerald-500">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link href={`/checkout?product=${product.id}`} className="btn-primary mt-6 w-full">
                Choose this plan
              </Link>
            </Card>
          ))}
        </div>

        {!loading && products.length === 0 && !error && (
          <Alert type="info">No packages are available yet. Please check back soon.</Alert>
        )}
      </main>
      <Footer />
    </>
  );
}
