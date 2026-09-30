import { chromium } from '@playwright/test';

/** Explicit backend selection keeps headless Linux qualification reproducible. */
export function launchWorldBrowser(options = {}) {
  const angle =
    process.env.WORLD_ANGLE ??
    (process.platform === 'win32' ? 'd3d11' : undefined);
  const channel = options.channel ?? process.env.WORLD_BROWSER_CHANNEL;
  return chromium.launch({
    ...(channel ? { channel } : {}),
    args: [
      '--enable-gpu',
      ...(angle ? [`--use-angle=${angle}`] : []),
      ...(angle === 'vulkan'
        ? ['--enable-features=Vulkan', '--ignore-gpu-blocklist']
        : []),
    ],
  });
}
