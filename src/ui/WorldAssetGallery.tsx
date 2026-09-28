import { useEffect, useRef, useState } from 'react';
import { WorldRenderer } from '../rendering/world/WorldRenderer';
import { WorldRuntime } from '../world/runtime';
import { generateWorld } from '../world/generation';
import { defaultWorldGenerationConfig } from '../world/model';

export default function WorldAssetGallery() {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<WorldRenderer | undefined>(undefined);
  const [ids, setIds] = useState<string[]>([]),
    [asset, setAsset] = useState('factory'),
    [lod, setLod] = useState(0),
    [rotation, setRotation] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    const snapshot = new WorldRuntime(
      generateWorld({
        ...defaultWorldGenerationConfig('asset-gallery'),
        width: 64,
        height: 64,
      }),
    ).snapshot();
    const view = new WorldRenderer(host.current!, snapshot, {
      onSelect: () => {},
      onSelectEntity: () => {},
      onHover: () => {},
      onReady: () => {
        setIds(view.assets.manifest!.assets.map((entry) => entry.id));
        view.showAsset('factory', 0, 0);
      },
      onAssetError: setError,
    });
    renderer.current = view;
    return () => {
      view.dispose();
      renderer.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (ids.length) renderer.current?.showAsset(asset, lod, rotation);
  }, [asset, lod, rotation, ids]);
  return (
    <main className="world-asset-gallery">
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: 16,
          background: '#202d33',
          color: '#f3f0e7',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <a href={import.meta.env.BASE_URL}>Return to game</a>
        <label>
          Asset{' '}
          <select
            aria-label="Asset"
            value={asset}
            onChange={(event) => setAsset(event.target.value)}
          >
            {ids.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          LOD{' '}
          <select
            aria-label="LOD"
            value={lod}
            onChange={(event) => setLod(Number(event.target.value))}
          >
            {[0, 1, 2].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setRotation((value) => (value + 1) % 4)}>
          Quarter turn {rotation}
        </button>
        <button onClick={() => renderer.current?.rotateCamera(1)}>Orbit</button>
        <button onClick={() => renderer.current?.setTopView()}>Top</button>
        <span>White: footprint · red: sockets</span>
        {error && <span role="alert">{error}</span>}
      </div>
    </main>
  );
}
