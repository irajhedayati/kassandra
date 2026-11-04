const RELEASES_URL = 'https://github.com/irajhedayati/kassandra/releases';

/**
 * Release notes page for `version`. Only a plain `X.Y.Z` version is known to
 * have a `vX.Y.Z` release; anything else (missing, dev or pre-release builds)
 * goes to the latest release instead.
 */
export function releaseUrl(version: string | undefined): string {
  return version && /^\d+\.\d+\.\d+$/.test(version)
    ? `${RELEASES_URL}/tag/v${version}`
    : `${RELEASES_URL}/latest`;
}
