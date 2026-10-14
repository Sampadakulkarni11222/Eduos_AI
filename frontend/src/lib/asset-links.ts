/**
 * Digital Asset Links for the Android app (a Trusted Web Activity).
 *
 * Android only hides the browser bar when the site it opens vouches for the
 * app: /.well-known/assetlinks.json must name the app's package and the
 * SHA-256 fingerprint of the certificate it was signed with. Both are facts of
 * a release that does not exist yet, so neither lives in the source — they are
 * read from the frontend server's environment:
 *
 *   TWA_PACKAGE_NAME          the application id, e.g. the one chosen in Play Console
 *   TWA_SHA256_FINGERPRINTS   comma-separated certificate fingerprints. With
 *                             Play App Signing that is Google's app signing key
 *                             (Play Console → Setup → App integrity), plus the
 *                             upload key if locally built APKs are tested too.
 *
 * Kept free of Next.js so the rules can be tested as plain functions.
 */

/** A Java-style package name: two or more dot-separated identifiers. */
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
/** 32 colon-separated hex bytes, as `keytool -list -v` prints a SHA-256. */
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface AssetLinkStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

/**
 * The statements to publish, or null when the app is not configured.
 *
 * Null rather than a best effort: a file naming the wrong package or a
 * malformed fingerprint fails verification on the device with nothing to say
 * why, so a value that is not exactly right is treated as absent — and one bad
 * fingerprint discards the list rather than publishing part of it.
 */
export function buildAssetLinks(
  packageName: string | undefined,
  fingerprints: string | undefined,
): AssetLinkStatement[] | null {
  const pkg = String(packageName ?? '').trim();
  if (!PACKAGE_RE.test(pkg)) return null;

  const prints = String(fingerprints ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  if (!prints.length || !prints.every((f) => FINGERPRINT_RE.test(f))) return null;

  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [...new Set(prints)] },
    },
  ];
}
