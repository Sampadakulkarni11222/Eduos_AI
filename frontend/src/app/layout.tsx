import type { Metadata, Viewport } from 'next';
import { APP_THEME_COLOR } from '@/lib/app-identity';
import { AuthProvider } from '@/lib/auth';
import { PermissionsProvider } from '@/lib/permissions';
import NextAuthProvider from '@/lib/next-auth-provider';
import { ToastProvider } from '@/components/ui';
import { ServiceWorkerRegistration } from '@/components/pwa';
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
  // Home-screen name and icon on iOS, which reads these rather than the
  // manifest. The manifest link itself is added by app/manifest.ts.
  appleWebApp: { capable: true, title: 'EduOS AI', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  // Next's defaults, stated so the mobile layout does not depend on them.
  // Zoom is left enabled: disabling it fails WCAG 1.4.4.
  width: 'device-width',
  initialScale: 1,
  // Colours the system bars of an installed app and the browser toolbar.
  themeColor: APP_THEME_COLOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-chalk font-body text-ink antialiased">
        <ServiceWorkerRegistration />
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
