import Link from 'next/link';
import { Navbar, Footer } from '@/components/nav';

const features = [
  {
    title: 'Instant Provisioning',
    description: 'The moment your payment is confirmed, your VPN account is created automatically on the server you chose.',
    icon: '⚡',
  },
  {
    title: 'Multi-Server by Design',
    description: 'Add, disable or monitor unlimited Marzban panels from one admin panel - live status and capacity included.',
    icon: '🌐',
  },
  {
    title: 'Secure by Default',
    description: 'AES-256-GCM encrypted credentials, bcrypt password hashing, JWT rotation, HMAC-verified webhooks.',
    icon: '🔐',
  },
  {
    title: 'Payments via Bayar.gg',
    description: 'QRIS, e-wallet and card payments with automatic settlement webhooks and reconciliation.',
    icon: '💳',
  },
];

const steps = [
  { title: 'Pick a plan', description: 'Browse the catalog and choose the package that fits.' },
  { title: 'Choose your server', description: 'See live status, location and remaining capacity before paying.' },
  { title: 'Pay securely', description: 'Checkout through Bayar.gg - QRIS, e-wallet or card.' },
  { title: 'Connect instantly', description: 'Your subscription link appears in the dashboard, ready for any VPN client.' },
];

export default function LandingPage() {
  return (
    <>
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-white dark:from-brand-950/40 dark:via-zinc-950 dark:to-zinc-950" />
        <div className="relative mx-auto max-w-6xl px-4 py-24 text-center">
          <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            Production-ready · Docker · Multi-server
          </span>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
            Premium subscriptions,
            <span className="block text-brand-600 dark:text-brand-400">delivered in seconds.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            A modern, secure storefront for VPN subscriptions. Pick your server, pay with QRIS, and get your config
            automatically - powered by Marzban, Bayar.gg and Resend.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/catalog" className="btn-primary px-6 py-3 text-base">
              Browse packages
            </Link>
            <Link href="/register" className="btn-ghost px-6 py-3 text-base">
              Create account
            </Link>
          </div>
          <p className="mt-6 text-sm text-zinc-500">No hidden fees · Instant delivery · 24/7 uptime monitoring</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold tracking-tight">Built for scale and safety</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="card">
              <div className="text-3xl">{feature.icon}</div>
              <h3 className="mt-4 font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-4xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
        <ol className="mt-12 space-y-6">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 font-bold text-white">
                {index + 1}
              </span>
              <div className="card flex-1">
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-8">
        <div className="card bg-brand-600 text-center text-white dark:border-brand-500">
          <h2 className="text-2xl font-bold">Ready to get started?</h2>
          <p className="mt-2 text-brand-100">Create your account and your first subscription in under two minutes.</p>
          <Link
            href="/catalog"
            className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            View pricing
          </Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
