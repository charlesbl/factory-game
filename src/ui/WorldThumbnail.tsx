import { useEffect, useState } from 'react';
import type { WorldTool } from '../world/model';

let manifestRequest: Promise<Map<string, string>> | undefined;
const thumbnails = () =>
  (manifestRequest ??= fetch(
    `${import.meta.env.BASE_URL}assets/world/manifest.json`,
  )
    .then(async (response) => {
      if (!response.ok) throw new Error('Model thumbnails unavailable');
      const manifest = (await response.json()) as {
        assets: { id: string; thumbnail: { url: string } }[];
      };
      return new Map(
        manifest.assets.map((asset) => [
          asset.id,
          `${import.meta.env.BASE_URL}assets/world/${asset.thumbnail.url}`,
        ]),
      );
    })
    .catch((error: unknown) => {
      manifestRequest = undefined;
      throw error;
    }));

export function WorldThumbnail({ kind }: { readonly kind: WorldTool }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    const id =
      kind === 'rail'
        ? 'rail-straight'
        : kind === 'junction'
          ? 'rail-junction'
          : kind;
    void thumbnails()
      .then((urls) => {
        if (active) setUrl(urls.get(id));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind]);
  if (url)
    return (
      <img
        className="world-tool-thumbnail"
        src={url}
        alt=""
        width={64}
        height={64}
      />
    );
  return (
    <svg
      className="world-tool-thumbnail"
      viewBox="0 0 32 32"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d={
          kind === 'select'
            ? 'M8 4v23l6-7 5 8 4-2-5-8 9-1Z'
            : kind === 'dismantle' || kind === 'rail-erase'
              ? 'M7 9h18M11 9V5h10v4M9 9l2 18h10l2-18M14 13v10M18 13v10'
              : 'M6 27V10l10-6 10 6v17ZM6 10l10 6 10-6M16 16v11'
        }
      />
    </svg>
  );
}
