import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import { ThemeScript } from '@/components/theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'XStore - Premium VPN Subscriptions',
    template: '%s | XStore',
  },
  description: 'Modern subscription store: instant provisioning, multi-server, secure payments.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
