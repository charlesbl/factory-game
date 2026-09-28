import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const portable = join(
  process.env.LOCALAPPDATA ?? '',
  'FactoryGameTools',
  'blender-4.5.0-windows-x64',
  'blender.exe',
);
const executable =
  process.env.BLENDER_PATH ?? (existsSync(portable) ? portable : 'blender');
const preview = process.argv.includes('--preview');
const script = resolve(
  'scripts/assets',
  preview ? 'render_world_previews.py' : 'build_world_assets.py',
);
const args = process.argv.slice(2).filter((arg) => arg !== '--preview');
const result = spawnSync(
  executable,
  [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    script,
    '--',
    ...args,
  ],
  { stdio: 'inherit' },
);
if (result.error)
  console.error(
    'Blender 4.5.0 is required. Set BLENDER_PATH to its executable.',
    result.error.message,
  );
process.exit(result.status ?? 1);
