import { useQuery } from '@tanstack/react-query';
import { getAbout } from '../../api/about.js';
import { releaseUrl } from '../../utils/release.js';

/** Bottom strip of the sidebar: running version and a link to its release notes. */
export function SidebarFooter() {
  // The server is the source of truth; the build-time value covers the moment before it answers.
  const { data } = useQuery({
    queryKey: ['about'],
    queryFn: getAbout,
    staleTime: Infinity,
  });
  const version: string | undefined = data?.version ?? import.meta.env.VITE_APP_VERSION;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-cyan-400/20 px-4 py-3 text-xs text-slate-400">
      <span>Kassandra{version ? ` v${version}` : ''}</span>
      <a
        href={releaseUrl(version)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-300 hover:text-cyan-200 hover:underline"
      >
        What&apos;s new?
      </a>
    </div>
  );
}
