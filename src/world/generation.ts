import { asId, gridPoint, worldQuantity } from '../domain';
import type { GridPoint, WorldId } from '../domain';
import {
  MAX_OCCUPANCY_SLOT,
  MAX_ORE_PER_TILE,
  OreKind,
  TerrainKind,
  defaultWorldGenerationConfig,
  gridIndex,
  type GeneratedWorld,
  type SerializedGeneratedWorld,
  type WorldGenerationConfig,
  type WorldGrid,
} from './model';

const hashSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
};

class Xoshiro128StarStar {
  readonly #state = new Uint32Array(4);
  constructor(seed: string) {
    let value = hashSeed(seed);
    for (let index = 0; index < 4; index += 1) {
      value += 0x9e3779b9;
      let mixed = value;
      mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
      mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
      this.#state[index] = (mixed ^ (mixed >>> 15)) >>> 0;
    }
  }
  next(): number {
    const s = this.#state;
    const s0 = s[0]!;
    const s1 = s[1]!;
    const s2 = s[2]!;
    const s3 = s[3]!;
    const result =
      Math.imul(
        ((Math.imul(s1, 5) << 7) | (Math.imul(s1, 5) >>> 25)) >>> 0,
        9,
      ) >>> 0;
    const t = (s1 << 9) >>> 0;
    const n2 = (s2 ^ s0) >>> 0;
    const n3 = (s3 ^ s1) >>> 0;
    const n1 = (s1 ^ n2) >>> 0;
    const n0 = (s0 ^ n3) >>> 0;
    s[0] = n0;
    s[1] = n1;
    s[2] = (n2 ^ t) >>> 0;
    s[3] = ((n3 << 11) | (n3 >>> 21)) >>> 0;
    return result;
  }
  integer(minimum: number, maximumExclusive: number): number {
    return minimum + (this.next() % (maximumExclusive - minimum));
  }
}

interface PatchZone {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}
const PATCH_ZONE_SIZE = 9;
const PATCH_ZONE_STRIDE = PATCH_ZONE_SIZE + 1;
const patchZones = (
  width: number,
  height: number,
  clearingSize: number,
): readonly PatchZone[] => {
  const spawnX = Math.floor(width / 2);
  const spawnY = Math.floor(height / 2);
  const clearingX = spawnX - Math.floor(clearingSize / 2);
  const clearingY = spawnY - Math.floor(clearingSize / 2);
  const result: PatchZone[] = [];
  for (let y = 0; y + PATCH_ZONE_SIZE <= height; y += PATCH_ZONE_STRIDE)
    for (let x = 0; x + PATCH_ZONE_SIZE <= width; x += PATCH_ZONE_STRIDE) {
      const overlapsClearing =
        x < clearingX + clearingSize &&
        x + PATCH_ZONE_SIZE > clearingX &&
        y < clearingY + clearingSize &&
        y + PATCH_ZONE_SIZE > clearingY;
      if (!overlapsClearing) result.push({ x, y, size: PATCH_ZONE_SIZE });
    }
  return result;
};

export const validateWorldGenerationConfig = (
  config: WorldGenerationConfig,
): void => {
  if (typeof config !== 'object' || config === null)
    throw new TypeError('World generation config must be an object');
  if (config.schemaVersion !== 1 || config.generatorVersion !== 1)
    throw new Error('Unsupported world generator version');
  if (typeof config.seed !== 'string')
    throw new TypeError('World seed must be a string');
  if (
    ![
      config.width,
      config.height,
      config.spawnClearingSize,
      config.patchesPerResource,
      config.orePerTile,
    ].every(Number.isSafeInteger)
  )
    throw new RangeError('World generation values must be safe integers');
  if (
    config.width < 64 ||
    config.height < 64 ||
    config.width > 1024 ||
    config.height > 1024
  )
    throw new RangeError('World dimensions must be between 64 and 1024');
  if (
    config.spawnClearingSize < 16 ||
    config.spawnClearingSize >= Math.min(config.width, config.height)
  )
    throw new RangeError('Invalid spawn clearing size');
  if (config.patchesPerResource < 1 || config.patchesPerResource > 32)
    throw new RangeError('Invalid patch count');
  if (config.orePerTile < 1 || config.orePerTile > MAX_ORE_PER_TILE)
    throw new RangeError('Ore per tile must fit a Uint32 and be positive');
  worldQuantity(config.orePerTile);
  if (
    patchZones(config.width, config.height, config.spawnClearingSize).length <
    config.patchesPerResource * 2
  )
    throw new RangeError(
      'World is too small for the requested distinct ore patches',
    );
};

const neighbours = (
  width: number,
  height: number,
  x: number,
  y: number,
): readonly number[] => {
  const result: number[] = [];
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height)
      result.push(ny * width + nx);
  }
  return result;
};

const generateTerrain = (grid: WorldGrid, random: Xoshiro128StarStar): void => {
  for (let index = 0; index < grid.terrain.length; index += 1)
    grid.terrain[index] =
      random.integer(0, 100) < 34
        ? TerrainKind.OBSTACLE
        : TerrainKind.BUILDABLE;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = grid.terrain.slice();
    for (let y = 1; y < grid.height - 1; y += 1)
      for (let x = 1; x < grid.width - 1; x += 1) {
        let obstacles = 0;
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1)
            if (
              (dx !== 0 || dy !== 0) &&
              grid.terrain[(y + dy) * grid.width + x + dx] ===
                TerrainKind.OBSTACLE
            )
              obstacles += 1;
        next[y * grid.width + x] =
          obstacles >= 5 ? TerrainKind.OBSTACLE : TerrainKind.BUILDABLE;
      }
    grid.terrain.set(next);
  }
};

const clearSpawn = (grid: WorldGrid, spawn: GridPoint, size: number): void => {
  const startX = spawn.x - Math.floor(size / 2);
  const startY = spawn.y - Math.floor(size / 2);
  for (let y = startY; y < startY + size; y += 1)
    for (let x = startX; x < startX + size; x += 1)
      grid.terrain[y * grid.width + x] = TerrainKind.BUILDABLE;
};

const inSpawnClearing = (
  spawn: GridPoint,
  size: number,
  index: number,
  width: number,
): boolean => {
  const x = index % width;
  const y = Math.floor(index / width);
  const startX = spawn.x - Math.floor(size / 2);
  const startY = spawn.y - Math.floor(size / 2);
  return x >= startX && x < startX + size && y >= startY && y < startY + size;
};

const growPatch = (
  grid: WorldGrid,
  random: Xoshiro128StarStar,
  centre: GridPoint,
  ore: OreKind,
  quantity: number,
  wanted: number,
  owner: number,
  owners: Int16Array,
  spawn: GridPoint,
  clearingSize: number,
  zone: PatchZone,
): boolean => {
  const first = gridIndex(grid, centre);
  if (
    first < 0 ||
    grid.oreKinds[first] !== OreKind.NONE ||
    inSpawnClearing(spawn, clearingSize, first, grid.width)
  )
    return false;
  const frontier = [first];
  const queued = new Uint8Array(grid.terrain.length);
  queued[first] = 1;
  const chosen: number[] = [];
  while (frontier.length > 0 && chosen.length < wanted) {
    const pick = random.integer(0, frontier.length);
    const index = frontier.splice(pick, 1)[0]!;
    if (
      grid.oreKinds[index] !== OreKind.NONE ||
      inSpawnClearing(spawn, clearingSize, index, grid.width)
    )
      continue;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (
      neighbours(grid.width, grid.height, x, y).some(
        (next) => grid.oreKinds[next] === ore && owners[next] !== owner,
      )
    )
      continue;
    chosen.push(index);
    owners[index] = owner;
    grid.oreKinds[index] = ore;
    grid.oreRemaining[index] = quantity;
    for (const next of neighbours(grid.width, grid.height, x, y)) {
      const nx = next % grid.width;
      const ny = Math.floor(next / grid.width);
      if (
        nx >= zone.x &&
        nx < zone.x + zone.size &&
        ny >= zone.y &&
        ny < zone.y + zone.size &&
        queued[next] === 0
      ) {
        queued[next] = 1;
        frontier.push(next);
      }
    }
  }
  if (chosen.length < wanted) {
    for (const index of chosen) {
      owners[index] = 0;
      grid.oreKinds[index] = OreKind.NONE;
      grid.oreRemaining[index] = 0;
    }
    return false;
  }
  for (const index of chosen) grid.terrain[index] = TerrainKind.BUILDABLE;
  return true;
};

const reachable = (grid: WorldGrid, start: GridPoint): Uint8Array => {
  const seen = new Uint8Array(grid.terrain.length);
  const first = gridIndex(grid, start);
  const queue = [first];
  seen[first] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    for (const next of neighbours(grid.width, grid.height, x, y))
      if (seen[next] === 0 && grid.terrain[next] === TerrainKind.BUILDABLE) {
        seen[next] = 1;
        queue.push(next);
      }
  }
  return seen;
};

const carveToClosest = (
  grid: WorldGrid,
  spawn: GridPoint,
  ore: OreKind,
): void => {
  const access = reachable(grid, spawn);
  if (grid.oreKinds.some((kind, index) => kind === ore && access[index] === 1))
    return;
  let target = -1;
  let distance = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < grid.oreKinds.length; index += 1)
    if (grid.oreKinds[index] === ore) {
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      const candidate = Math.abs(x - spawn.x) + Math.abs(y - spawn.y);
      if (candidate < distance || (candidate === distance && index < target)) {
        target = index;
        distance = candidate;
      }
    }
  if (target < 0)
    throw new Error('Generated world is missing a required ore patch');
  let x = spawn.x;
  let y = spawn.y;
  const tx = target % grid.width;
  const ty = Math.floor(target / grid.width);
  while (x !== tx) {
    x += Math.sign(tx - x);
    grid.terrain[y * grid.width + x] = TerrainKind.BUILDABLE;
  }
  while (y !== ty) {
    y += Math.sign(ty - y);
    grid.terrain[y * grid.width + x] = TerrainKind.BUILDABLE;
  }
};

export const generateWorld = (
  config: WorldGenerationConfig = defaultWorldGenerationConfig(),
): GeneratedWorld => {
  validateWorldGenerationConfig(config);
  const length = config.width * config.height;
  const grid: WorldGrid = {
    width: config.width,
    height: config.height,
    terrain: new Uint8Array(length),
    oreKinds: new Uint8Array(length),
    oreRemaining: new Uint32Array(length),
    occupancy: new Int32Array(length),
  };
  const random = new Xoshiro128StarStar(
    `${config.generatorVersion}:${config.seed}`,
  );
  const spawn = gridPoint(
    Math.floor(config.width / 2),
    Math.floor(config.height / 2),
  );
  generateTerrain(grid, random);
  clearSpawn(grid, spawn, config.spawnClearingSize);
  const owners = new Int16Array(length);
  const zones = [
    ...patchZones(config.width, config.height, config.spawnClearingSize),
  ];
  for (let index = zones.length - 1; index > 0; index -= 1) {
    const other = random.integer(0, index + 1);
    [zones[index], zones[other]] = [zones[other]!, zones[index]!];
  }
  let owner = 0;
  let zoneIndex = 0;
  for (const ore of [OreKind.IRON, OreKind.COPPER])
    for (let patch = 0; patch < config.patchesPerResource; patch += 1) {
      owner += 1;
      const wanted = random.integer(24, 49);
      const zone = zones[zoneIndex++]!;
      const centre = gridPoint(
        random.integer(zone.x, zone.x + zone.size),
        random.integer(zone.y, zone.y + zone.size),
      );
      const placed = growPatch(
        grid,
        random,
        centre,
        ore,
        config.orePerTile,
        wanted,
        owner,
        owners,
        spawn,
        config.spawnClearingSize,
        zone,
      );
      if (!placed)
        throw new RangeError(
          `Unable to place ore patch ${patch + 1} for resource ${ore}`,
        );
    }
  carveToClosest(grid, spawn, OreKind.IRON);
  carveToClosest(grid, spawn, OreKind.COPPER);
  return {
    schemaVersion: 1,
    id: asId<WorldId>(
      `world-${hashSeed(config.seed).toString(16).padStart(8, '0')}`,
    ),
    config,
    spawn,
    grid,
  };
};

export const serializeGeneratedWorld = (
  world: GeneratedWorld,
): SerializedGeneratedWorld => ({
  schemaVersion: 1,
  id: world.id,
  config: { ...world.config },
  spawn: { ...world.spawn },
  terrain: [...world.grid.terrain],
  oreKinds: [...world.grid.oreKinds],
  oreRemaining: [...world.grid.oreRemaining],
  occupancy: [...world.grid.occupancy],
});
export const deserializeGeneratedWorld = (
  world: SerializedGeneratedWorld,
): GeneratedWorld => {
  if (typeof world !== 'object' || world === null || world.schemaVersion !== 1)
    throw new Error('Invalid serialized world');
  validateWorldGenerationConfig(world.config);
  const length = world.config.width * world.config.height;
  const arrays = [
    world.terrain,
    world.oreKinds,
    world.oreRemaining,
    world.occupancy,
  ];
  if (
    !arrays.every(Array.isArray) ||
    arrays.some((array) => array.length !== length)
  )
    throw new Error('Invalid serialized world arrays');
  for (let index = 0; index < length; index += 1) {
    const terrain = world.terrain[index];
    const ore = world.oreKinds[index];
    const remaining = world.oreRemaining[index];
    const occupancy = world.occupancy[index];
    if (
      (terrain !== TerrainKind.BUILDABLE && terrain !== TerrainKind.OBSTACLE) ||
      (ore !== OreKind.NONE && ore !== OreKind.IRON && ore !== OreKind.COPPER)
    )
      throw new Error('Invalid serialized world cell kind');
    if (
      typeof remaining !== 'number' ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0 ||
      remaining > MAX_ORE_PER_TILE ||
      (ore === OreKind.NONE && remaining !== 0)
    )
      throw new Error('Invalid serialized ore quantity');
    if (
      typeof occupancy !== 'number' ||
      !Number.isSafeInteger(occupancy) ||
      occupancy < 0 ||
      occupancy > MAX_OCCUPANCY_SLOT
    )
      throw new Error('Invalid serialized occupancy slot');
  }
  if (
    typeof world.id !== 'string' ||
    typeof world.spawn !== 'object' ||
    world.spawn === null
  )
    throw new Error('Invalid serialized world identity');
  const spawn = gridPoint(world.spawn.x, world.spawn.y);
  const id = asId<WorldId>(world.id);
  if (
    gridIndex(
      { width: world.config.width, height: world.config.height },
      spawn,
    ) < 0
  )
    throw new Error('Invalid serialized spawn');
  return {
    schemaVersion: 1,
    id,
    config: { ...world.config },
    spawn,
    grid: {
      width: world.config.width,
      height: world.config.height,
      terrain: Uint8Array.from(world.terrain),
      oreKinds: Uint8Array.from(world.oreKinds),
      oreRemaining: Uint32Array.from(world.oreRemaining),
      occupancy: Int32Array.from(world.occupancy),
    },
  };
};
