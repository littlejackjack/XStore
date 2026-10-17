'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { endpoints } from '@/lib/api';
import { Navbar, Footer } from '@/components/nav';
import { Card, Alert, Spinner } from '@/components/ui';

function LoginInner() {
  const { login, loginWithOtp } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.push(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await endpoints.requestOtp(email, 'LOGIN');
      setCodeSent(true);
      setNotice(`A 6-digit code was sent to ${email}. It expires in ${result.expiresInMinutes} minutes.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await loginWithOtp(email, code);
      router.push(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'password' | 'otp') => {
    setMode(next);
    setCodeSent(false);
    setCode('');
    setError('');
    setNotice('');
  };

  return (
    <>
      <Navbar />
      <main className="mx-auto flex max-w-md px-4 py-20">
        <Card className="w-full">
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-zinc-500">Log in to manage your subscriptions.</p>

          {error && (
            <div className="mt-4">
              <Alert>{error}</Alert>
            </div>
          )}
          {notice && (
            <div className="mt-4">
              <Alert type="success">{notice}</Alert>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => switchMode('password')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === 'password'
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => switchMode('otp')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === 'otp'
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              Email code
            </button>
          </div>

          {mode === 'password' ? (
            <form className="mt-6 space-y-4" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="otp-email">
                  Email
                </label>
                <input
                  id="otp-email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              {!codeSent ? (
                <button type="button" className="btn-primary w-full" disabled={loading} onClick={sendCode}>
                  {loading ? 'Sending...' : 'Send me a login code'}
                </button>
              ) : (
                <form className="space-y-4" onSubmit={verifyCode}>
                  <div>
                    <label className="label" htmlFor="otp-code">
                      6-digit code
                    </label>
                    <input
                      id="otp-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      className="input text-center text-2xl tracking-[0.5em]"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <button type="submit" className="btn-primary w-full" disabled={loading || code.length !== 6}>
                    {loading ? 'Verifying...' : 'Verify and sign in'}
                  </button>
                  <button type="button" className="btn-ghost w-full" disabled={loading} onClick={sendCode}>
                    Resend code
                  </button>
                </form>
              )}

              <p className="text-sm text-zinc-500">
                We email a one-time code instead of asking for your password. The code is valid for 10 minutes.
              </p>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-zinc-500">
            No account?{' '}
            <Link href="/register" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
              Create one
            </Link>
          </p>
        </Card>
      </main>
      <Footer />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <>
          <Navbar />
          <Spinner />
          <Footer />
        </>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
