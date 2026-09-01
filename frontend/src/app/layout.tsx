import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { PermissionsProvider } from '@/lib/permissions';
import NextAuthProvider from '@/lib/next-auth-provider';
import { ToastProvider } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  // The platform, not a school: these pages serve every school on it. A page
  // that knows which school it is showing sets its own title on top of this
  // (see PortalShell and the sign-in screen).
  title: {
    default: 'EduOS AI',
    template: '%s · EduOS AI',
  },
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
