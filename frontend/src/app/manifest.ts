import type { MetadataRoute } from 'next';
import { APP_BACKGROUND_COLOR, APP_THEME_COLOR } from '@/lib/app-identity';

/**
 * The web app manifest, served at /manifest.webmanifest.
 *
 * It describes the platform, not a school: one installed EduOS AI serves every
 * school, so its name and icon belong to none of them (the same reasoning as
 * icon.svg). A school's own branding still appears once its door is open.
 *
 * `start_url` is the school finder rather than `/`. `/` sends anyone who is not
 * signed in to the platform sign-in, which admits Super Admins only — the wrong
 * first screen for the people an installed app is for. The finder forwards a
 * signed-in user to their portal and a returning one to their school's door.
 *
 * Every URL here is relative, so the manifest is correct on whichever host
 * serves it and names no deployment.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'EduOS AI',
    short_name: 'EduOS',
    description: 'The AI-native school operating system',
    start_url: '/find-school',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'en',
    categories: ['education'],
    theme_color: APP_THEME_COLOR,
    background_color: APP_BACKGROUND_COLOR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
