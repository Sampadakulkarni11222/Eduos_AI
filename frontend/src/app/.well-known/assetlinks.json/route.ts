import { NextResponse } from 'next/server';
import { buildAssetLinks } from '@/lib/asset-links';

// Read from the environment on each request, not baked in at build time: the
// fingerprint is only known once Play has signed a release, which is after the
// site that must publish it has been built.
export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/assetlinks.json
 *
 * 404 until TWA_PACKAGE_NAME and TWA_SHA256_FINGERPRINTS are both set and
 * valid — see lib/asset-links.ts. Unconfigured, the site vouches for no app.
 */
export function GET() {
  const statements = buildAssetLinks(process.env.TWA_PACKAGE_NAME, process.env.TWA_SHA256_FINGERPRINTS);
  if (!statements) {
    return NextResponse.json({ error: 'Digital Asset Links are not configured' }, { status: 404 });
  }
  return NextResponse.json(statements, {
    // Android re-verifies periodically; an hour keeps a key rotation prompt.
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
