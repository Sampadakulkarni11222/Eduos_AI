import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { PermissionsProvider } from '@/lib/permissions';
import NextAuthProvider from '@/lib/next-auth-provider';
import { ToastProvider } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Oakridge Academy',
  description: 'The AI-native school operating system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-chalk font-body text-ink antialiased">
        <NextAuthProvider>
          <AuthProvider>
            <PermissionsProvider>
              <ToastProvider>{children}</ToastProvider>
            </PermissionsProvider>
          </AuthProvider>
        </NextAuthProvider>
      </body>
    </html>
  );
}
