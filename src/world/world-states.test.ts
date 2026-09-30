import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asId, gridSize, worldContent } from '../domain';
import type {
  GridPoint,
  ResourceId,
  StationId,
  WorldEntityId,
} from '../domain';
import type { WorldSnapshot } from './model';
import type {
  WorldCommand,
  WorldCommandInput,
  WorldDelta,
  WorldWorkerResponse,
} from './protocol';
import { WORLD_PROTOCOL_VERSION } from './protocol';
import { serializeWorldRuntime } from './serialization';
import { createStatesFixture, type StatesFixture } from './states-fixture';

/**
 * Real-world-worker acceptance for stopped machinery and mine/drill placement
 * rules. The worker module runs unmodified behind a shim `self`; every command
 * round-trips through `self.onmessage`/`self.postMessage`.
 */
const posted: WorldWorkerResponse[] = [];
let dispatch: ((event: { data: WorldCommand }) => void) | undefined;
let revision = 0;
let requestSeq = 0;

beforeAll(async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.self = globalThis;
  globals.postMessage = (data: WorldWorkerResponse): void => {
    posted.push(data);
  };
  await import('./world.worker');
  dispatch = (
    globalThis as unknown as {
      onmessage?: (event: { data: WorldCommand }) => void;
    }
  ).onmessage;
  if (dispatch === undefined)
    throw new Error('world worker handler was not installed');
});

afterAll(() => {
  dispatch = undefined;
});

const trackRevision = (response: WorldWorkerResponse): void => {
  if ('revision' in response && typeof response.revision === 'number')
    revision = response.revision;
  if (response.type === 'READY') revision = response.snapshot.revision;
  if (response.type === 'DELTA' || response.type === 'ADVANCE_PAUSED')
    revision = response.delta.revision;
};

const send = (input: WorldCommandInput): WorldWorkerResponse => {
  const handler = dispatch;
  if (handler === undefined) throw new Error('worker not ready');
  requestSeq += 1;
  posted.length = 0;
  handler({
    data: {
      ...input,
      expectedRevision: revision,
      protocolVersion: WORLD_PROTOCOL_VERSION,
      requestId: `states-${requestSeq}`,
    } as WorldCommand,
  });
  expect(posted).toHaveLength(1);
  const response = posted[0]!;
  trackRevision(response);
  return response;
};

const loadFixture = (fixture: StatesFixture): void => {
  const response = send({
    type: 'LOAD',
    state: serializeWorldRuntime(fixture.runtime),
  });
  expect(response.type).toBe('READY');
};

const snapshotOf = (): WorldSnapshot => {
  const response = send({ type: 'SNAPSHOT' });
  if (response.type !== 'READY')
    throw new Error(`expected READY, received ${response.type}`);
  return response.snapshot;
};

const advance = (fixture: StatesFixture, ticks: bigint): WorldDelta => {
  const response = send({
    type: 'ADVANCE',
    target: fixture.runtime.logicalTime + ticks,
    eventBudget: 8,
  });
  if (response.type === 'DELTA' || response.type === 'ADVANCE_PAUSED')
    return response.delta;
  throw new Error(`expected delta, received ${response.type}`);
};

const errorText = (response: WorldWorkerResponse): string => {
  if ('error' in response && typeof response.error === 'string')
    return response.error;
  if ('message' in response && typeof response.message === 'string')
    return response.message;
  return JSON.stringify(response);
};

const validationOf = (
  input: WorldCommandInput,
): { valid: boolean; reason?: string } => {
  const response = send(input);
  if (response.type === 'VALIDATION') return response.validation;
  throw new Error(`expected VALIDATION, received ${response.type}`);
};

const factoryOf = (snapshot: WorldSnapshot, id: string) => {
  const building = snapshot.buildings.find((item) => item.entityId === id);
  if (building?.kind !== 'factory') throw new Error(`missing factory ${id}`);
  return building;
};

const mineOf = (snapshot: WorldSnapshot, id: string) => {
  const building = snapshot.buildings.find((item) => item.entityId === id);
  if (building?.kind !== 'mine') throw new Error(`missing mine ${id}`);
  return building;
};

const knownFactoryKeys = [
  'contract',
  'entityId',
  'inputs',
  'kind',
  'outputs',
  'state',
];
const knownMineKeys = [
  'construction',
  'drills',
  'entityId',
  'kind',
  'output',
  'salvage',
];
const causeLanguage = /downstream|because|caused|starved|blocked by/i;

const drillInput = (
  fixture: StatesFixture,
  position: GridPoint,
): WorldCommandInput => ({
  type: 'VALIDATE_GHOST',
  targetKind: 'drill',
  position,
  size: gridSize(1, 1),
  rotation: 0,
  mineId: asId<WorldEntityId>(fixture.ids.mine),
});

const mineHeadInput = (fixture: StatesFixture): WorldCommandInput => ({
  type: 'VALIDATE_GHOST',
  targetKind: 'mine',
  position: fixture.tiles.mineHeadPosition,
  size: gridSize(4, 4),
  rotation: 0,
  stationId: asId<StationId>(fixture.ids.mineHeadStation),
  resourceId: asId<ResourceId>('ironOre'),
});

describe('stopped machinery reports only known facts (real worker)', () => {
  it('a constructed factory whose input never arrives reports WAITING_INPUT', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const waiting = factoryOf(snapshotOf(), fixture.ids.waitingFactory);
    expect(waiting.state).toBe('WAITING_INPUT');
    expect(
      waiting.inputs.map((b) => [b.resourceId, b.quantity, b.capacity]),
    ).toEqual([['ironOre', 0, 20]]);
    expect(waiting.outputs.map((b) => b.quantity)).toEqual([0]);
    expect(waiting.nextEventAt).toBeUndefined();
    // WorldBuildingSnapshot exposes exactly the known fields.
    expect(Object.keys(waiting).sort()).toEqual([...knownFactoryKeys].sort());
    // No invented downstream cause anywhere in the surface.
    expect(JSON.stringify(waiting)).not.toMatch(causeLanguage);

    // Stopped machinery stays stopped across advances.
    const before = snapshotOf();
    const delta = advance(fixture, 500_000_000_000n);
    expect(delta.drillExtractionIds).toEqual([]);
    expect(delta.oreChanges).toEqual([]);
    const after = snapshotOf();
    expect(after.buildings).toEqual(before.buildings);
    expect(after.stations).toEqual(before.stations);
    expect(after.grid.oreRemaining).toEqual(before.grid.oreRemaining);
  });

  it('a factory with a full undeliverable output reports OUTPUT_BLOCKED', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const before = snapshotOf();
    const blocked = factoryOf(before, fixture.ids.blockedFactory);
    expect(blocked.state).toBe('OUTPUT_BLOCKED');
    expect(blocked.outputs.map((b) => [b.quantity, b.capacity])).toEqual([
      [20, 20],
    ]);
    expect(blocked.nextEventAt).toBeUndefined();
    expect(Object.keys(blocked).sort()).toEqual([...knownFactoryKeys].sort());
    expect(JSON.stringify(blocked)).not.toMatch(causeLanguage);

    const delta = advance(fixture, 20_000_000_000n);
    expect(delta.drillExtractionIds).toEqual([]);
    expect(delta.oreChanges).toEqual([]);
    const after = snapshotOf();
    expect(factoryOf(after, fixture.ids.blockedFactory).state).toBe(
      'OUTPUT_BLOCKED',
    );
    // No items are created or destroyed while the output stays blocked.
    expect(after.buildings).toEqual(before.buildings);
    expect(after.stations).toEqual(before.stations);
    expect(after.grid.oreRemaining).toEqual(before.grid.oreRemaining);
  });

  it('an ACTIVE drill with a full mine output stops extraction while ore keeps stock', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const before = snapshotOf();
    const drill = before.entities.find(
      (e) => e.id === asId<WorldEntityId>(fixture.ids.drill),
    );
    expect(drill).toMatchObject({
      kind: 'drill',
      state: 'ACTIVE',
      mineId: asId<WorldEntityId>(fixture.ids.mine),
    });
    const mine = mineOf(before, fixture.ids.mine);
    expect(mine.output.quantity).toBe(mine.output.capacity);
    expect(mine.output.quantity).toBe(100);
    expect(mine.drills).toEqual({ ghost: 0, active: 1, exhausted: 0 });
    expect(Object.keys(mine).sort()).toEqual([...knownMineKeys].sort());
    expect(JSON.stringify(mine)).not.toMatch(causeLanguage);

    // 500 seeded minus the one reported extraction; the tile keeps its stock.
    const tileIndex =
      fixture.positions.drill.y * before.grid.width + fixture.positions.drill.x;
    expect(before.grid.oreRemaining[tileIndex]).toBe(400);

    // Extraction is reported exactly: with the full output nothing is reported
    // and nothing moves, while the drill stays ACTIVE.
    for (const ticks of [2_000_000_000n, 5_000_000_000n]) {
      const delta = advance(fixture, ticks);
      expect(delta.drillExtractionIds).toEqual([]);
      expect(delta.oreChanges).toEqual([]);
      const after = snapshotOf();
      expect(after.grid.oreRemaining[tileIndex]).toBe(400);
      expect(mineOf(after, fixture.ids.mine).output.quantity).toBe(100);
      const drillAfter = after.entities.find(
        (e) => e.id === asId<WorldEntityId>(fixture.ids.drill),
      );
      expect(
        drillAfter && drillAfter.kind === 'drill'
          ? drillAfter.state
          : undefined,
      ).toBe('ACTIVE');
    }
  });
});

describe('mine/drill placement rules (real worker)', () => {
  it('rejects a mine head on ore with ORE_MISMATCH and leaves the world unchanged', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    expect(validationOf(mineHeadInput(fixture))).toEqual({
      valid: false,
      reason: 'ORE_MISMATCH',
    });
    const before = snapshotOf();
    const response = send({
      type: 'CREATE_SITE',
      targetKind: 'mine',
      position: fixture.tiles.mineHeadPosition,
      size: gridSize(4, 4),
      rotation: 0,
      stationId: asId<StationId>(fixture.ids.mineHeadStation),
      resourceId: asId<ResourceId>('ironOre'),
      cost: [],
    });
    expect(response.type).toBe('ERROR');
    expect(errorText(response)).toContain('Invalid construction site');
    expect(errorText(response)).toContain('ORE_MISMATCH');
    expect(snapshotOf().entities).toEqual(before.entities);
  });

  it('rejects drills on wrong or exhausted ore with ORE_MISMATCH', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    expect(validationOf(drillInput(fixture, fixture.tiles.wrongOre))).toEqual({
      valid: false,
      reason: 'ORE_MISMATCH',
    });
    expect(
      validationOf(drillInput(fixture, fixture.tiles.exhaustedOre)),
    ).toEqual({
      valid: false,
      reason: 'ORE_MISMATCH',
    });
  });

  it('requires the second drill to touch the mine or the first drill chain', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const mineId = asId<WorldEntityId>(fixture.ids.mine);
    // Before any new drill: chainSecond touches neither the mine nor a drill.
    expect(
      validationOf(drillInput(fixture, fixture.tiles.chainSecond)),
    ).toEqual({
      valid: false,
      reason: 'NOT_CONNECTED',
    });
    // chainFirst touches the mine directly.
    expect(validationOf(drillInput(fixture, fixture.tiles.chainFirst))).toEqual(
      {
        valid: true,
      },
    );
    const placed1 = send({
      type: 'PLACE_DRILL',
      mineId,
      position: fixture.tiles.chainFirst,
    });
    expect(placed1.type).toBe('DELTA');
    // Now the chained tile is valid; the disconnected tile stays rejected.
    expect(
      validationOf(drillInput(fixture, fixture.tiles.chainSecond)),
    ).toEqual({
      valid: true,
    });
    const placed2 = send({
      type: 'PLACE_DRILL',
      mineId,
      position: fixture.tiles.chainSecond,
    });
    expect(placed2.type).toBe('DELTA');
    expect(
      validationOf(drillInput(fixture, fixture.tiles.disconnected)),
    ).toEqual({
      valid: false,
      reason: 'NOT_CONNECTED',
    });
    const before = snapshotOf();
    const rejected = send({
      type: 'PLACE_DRILL',
      mineId,
      position: fixture.tiles.disconnected,
    });
    expect(rejected.type).toBe('ERROR');
    expect(errorText(rejected)).toContain(
      'Drill must touch the mine or another drill',
    );
    expect(snapshotOf().entities).toEqual(before.entities);
  });

  it('keeps the mine binding across placements and clears it only when the mine is removed', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const mineId = asId<WorldEntityId>(fixture.ids.mine);
    const untouchedBefore = validationOf(mineHeadInput(fixture));
    send({ type: 'PLACE_DRILL', mineId, position: fixture.tiles.chainFirst });
    send({ type: 'PLACE_DRILL', mineId, position: fixture.tiles.chainSecond });
    const snap = snapshotOf();
    for (const position of [
      fixture.tiles.chainFirst,
      fixture.tiles.chainSecond,
      fixture.positions.drill,
    ]) {
      const drill = snap.entities.find(
        (e) =>
          e.kind === 'drill' &&
          e.transform.position.x === position.x &&
          e.transform.position.y === position.y,
      );
      expect(drill && drill.kind === 'drill' ? drill.mineId : undefined).toBe(
        mineId,
      );
    }
    // Cursor validation is side-effect free: the untouched ghost validates the
    // same before and after the placements and the domain rules do not move.
    expect(validationOf(mineHeadInput(fixture))).toEqual(untouchedBefore);
    expect(
      validationOf(drillInput(fixture, fixture.tiles.disconnected)),
    ).toEqual({
      valid: false,
      reason: 'NOT_CONNECTED',
    });

    // The binding is kept until the mine is removed.
    const dismantle = send({ type: 'DISMANTLE_ENTITY', entityId: mineId });
    expect(dismantle.type).not.toBe('ERROR');
    expect(
      validationOf(drillInput(fixture, fixture.tiles.disconnected)),
    ).toEqual({ valid: false, reason: 'NOT_CONNECTED' });
  });
});

describe('mine/drill construction rejects at runtime with its exact reasons', () => {
  it('rejects a disconnected second drill before and after the chain exists', () => {
    const fixture = createStatesFixture();
    const mineId = asId<WorldEntityId>(fixture.ids.mine);
    expect(() =>
      fixture.runtime.placeDrill(
        mineId,
        asId('test-second'),
        fixture.tiles.chainSecond,
      ),
    ).toThrow('Drill must touch the mine or another drill');
    fixture.runtime.placeDrill(
      mineId,
      asId('test-first'),
      fixture.tiles.chainFirst,
    );
    // The second drill chains to the first and is accepted.
    fixture.runtime.placeDrill(
      mineId,
      asId('test-second'),
      fixture.tiles.chainSecond,
    );
    expect(() =>
      fixture.runtime.placeDrill(
        mineId,
        asId('test-offchain'),
        fixture.tiles.disconnected,
      ),
    ).toThrow('Drill must touch the mine or another drill');
  });

  it('rejects drills on wrong or exhausted ore with the exact message', () => {
    const fixture = createStatesFixture();
    const mineId = asId<WorldEntityId>(fixture.ids.mine);
    expect(() =>
      fixture.runtime.placeDrill(
        mineId,
        asId('test-wrong'),
        fixture.tiles.wrongOre,
      ),
    ).toThrow('Drill must be placed on matching, non-exhausted ore');
    expect(() =>
      fixture.runtime.placeDrill(
        mineId,
        asId('test-gone'),
        fixture.tiles.exhaustedOre,
      ),
    ).toThrow('Drill must be placed on matching, non-exhausted ore');
  });

  it('keeps the mine binding until the mine is removed', () => {
    const fixture = createStatesFixture();
    const mineId = asId<WorldEntityId>(fixture.ids.mine);
    expect(
      fixture.runtime.validateGhost(
        'mine',
        {
          position: fixture.tiles.mineHeadPosition,
          size: gridSize(4, 4),
          rotation: 0,
        },
        asId<StationId>(fixture.ids.mineHeadStation),
        asId<ResourceId>('ironOre'),
      ),
    ).toEqual({ valid: false, reason: 'ORE_MISMATCH' });
    fixture.runtime.placeDrill(
      mineId,
      asId('test-first'),
      fixture.tiles.chainFirst,
    );
    for (const id of ['test-first', 'states-drill']) {
      const entity = fixture.runtime
        .snapshot()
        .entities.find((e) => e.id === asId(id));
      expect(
        entity && entity.kind === 'drill' ? entity.mineId : undefined,
      ).toBe(mineId);
    }
    expect(fixture.runtime.mines.get(mineId)).toBeDefined();
    fixture.runtime.dismantleEntity(mineId);
    expect(fixture.runtime.mines.get(mineId)).toBeUndefined();
    expect(
      fixture.runtime.validateInteraction(
        'drill',
        fixture.tiles.disconnected,
        mineId,
      ),
    ).toEqual({ valid: false, reason: 'NOT_CONNECTED' });
  });
});

describe('construction stages and the bounded cap (real worker)', () => {
  const sortedStacks = (
    items: readonly { resourceId: unknown; quantity: number }[],
  ): { resourceId: string; quantity: number }[] =>
    [...items]
      .map((item) => ({
        resourceId: String(item.resourceId),
        quantity: item.quantity,
      }))
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId));

  const siteOf = (snapshot: WorldSnapshot, id: string) => {
    const entity = snapshot.entities.find(
      (candidate) => candidate.id === asId<WorldEntityId>(id),
    );
    if (entity?.kind !== 'construction-site')
      throw new Error(`missing construction site ${id}`);
    return entity;
  };

  it('publishes per-resource delivery and replaces the site only at the exact cap', () => {
    const fixture = createStatesFixture();
    const storageCost =
      worldContent.buildings.find((building) => building.kind === 'storage')
        ?.buildCost ?? [];
    const siteId = fixture.ids.constructionSite;
    const completeId = fixture.ids.completeSite;
    const plates = [...storageCost].sort((a, b) => b.quantity - a.quantity)[0]!;
    // The second site is armed fixture-side before loading: the worker only
    // ever sees its fully buffered delivery buffers.
    fixture.armCompleteSite();
    loadFixture(fixture);
    // Stage facts arrive with the surface: per-resource required and delivered.
    const staged = snapshotOf();
    const site = siteOf(staged, siteId);
    expect(site.state).toBe('WAITING');
    expect(sortedStacks(site.required)).toEqual(
      sortedStacks(
        storageCost.map((item) => ({
          resourceId: item.resourceId,
          quantity: item.quantity,
        })),
      ),
    );
    expect(sortedStacks(site.delivered)).toEqual(
      sortedStacks(
        storageCost.map((item) => ({
          resourceId: item.resourceId,
          quantity: item.resourceId === plates.resourceId ? 6 : 0,
        })),
      ),
    );
    // The construction cap: every delivery buffer is capped at the required
    // quantity and over-delivery is rejected at the exact boundary.
    const stations = staged.stations.filter((station) =>
      station.id.startsWith(`site:${siteId}:`),
    );
    expect(stations.length).toBe(storageCost.length);
    for (const station of stations) {
      const need =
        storageCost.find((item) => item.resourceId === station.resourceId)
          ?.quantity ?? 0;
      expect(station.capacity).toBe(need);
    }
    const buffer = fixture.runtime.traffic.stations.get(
      `site:${siteId}:${plates.resourceId}`,
    )?.buffer;
    if (buffer === undefined) throw new Error('missing site delivery buffer');
    expect(() => buffer.add(17)).toThrow(/full/i);
    // A fully buffered site is still a 100% preview: the surface keeps showing
    // the construction site until the worker's accepted advance replaces it.
    expect(
      staged.entities.find(
        (candidate) => candidate.id === asId<WorldEntityId>(completeId),
      )?.kind,
    ).toBe('construction-site');
    advance(fixture, 1n);
    const after = snapshotOf();
    expect(
      after.entities.find(
        (candidate) => candidate.id === asId<WorldEntityId>(completeId),
      )?.kind,
    ).toBe('storage');
    expect(
      after.stations.filter((station) =>
        station.id.startsWith(`site:${completeId}:`),
      ),
    ).toEqual([]);
    // The partial site survives the advance with its delivered counts.
    const partialAfter = siteOf(after, siteId);
    expect(partialAfter.state).toBe('WAITING');
    expect(sortedStacks(partialAfter.delivered)).toEqual(
      sortedStacks(
        storageCost.map((item) => ({
          resourceId: item.resourceId,
          quantity: item.resourceId === plates.resourceId ? 6 : 0,
        })),
      ),
    );
  });
});

describe('dismantling recovery (real worker)', () => {
  const salvageRows = (
    snapshot: WorldSnapshot,
    entityId: string,
  ): {
    resourceId: string;
    quantity: number | undefined;
    capacity: number | undefined;
    role: string;
  }[] =>
    snapshot.stations
      .filter((station) => station.id.startsWith(`salvage:${entityId}:`))
      .map((station) => ({
        resourceId: String(station.resourceId),
        quantity: station.quantity,
        capacity: station.capacity,
        role: station.role,
      }))
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId));

  const expectedRows = (
    expected: Map<string, number>,
  ): {
    resourceId: string;
    quantity: number;
    capacity: number;
    role: string;
  }[] =>
    [...expected]
      .map(([resourceId, quantity]) => ({
        resourceId,
        quantity,
        capacity: quantity,
        role: 'active-provider',
      }))
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId));

  it('keeps a dismantling factory marked and parks salvage at its station', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const before = snapshotOf();
    const factory = factoryOf(before, fixture.ids.waitingFactory);
    // Recovered materials are the input/output buffers plus the contract bill.
    const expected = new Map<string, number>();
    const bump = (resourceId: string, quantity: number): void => {
      expected.set(resourceId, (expected.get(resourceId) ?? 0) + quantity);
    };
    for (const buffer of [...factory.inputs, ...factory.outputs])
      bump(String(buffer.resourceId), buffer.quantity);
    for (const item of factory.contract.billOfMaterials ?? [])
      bump(String(item.resourceId), item.quantity);
    const response = send({
      type: 'DISMANTLE_ENTITY',
      entityId: asId<WorldEntityId>(fixture.ids.waitingFactory),
    });
    expect(response.type).toBe('DELTA');
    const after = snapshotOf();
    const entity = after.entities.find(
      (candidate) =>
        candidate.id === asId<WorldEntityId>(fixture.ids.waitingFactory),
    );
    // The factory stays listed as dismantling while its building is gone.
    expect(entity && entity.kind === 'factory' ? entity.state : undefined).toBe(
      'DISMANTLING',
    );
    expect(
      after.buildings.find(
        (building) => building.entityId === fixture.ids.waitingFactory,
      ),
    ).toBeUndefined();
    // Salvage sits at the linked station as provider buffers, integer exact.
    expect(salvageRows(after, fixture.ids.waitingFactory)).toEqual(
      expectedRows(expected),
    );
  });

  it('keeps a dismantled mine cancellable until its salvage and active deliveries have cleared', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const before = snapshotOf();
    const mineEntity = before.entities.find(
      (candidate) => candidate.id === asId<WorldEntityId>(fixture.ids.mine),
    );
    const oreId =
      mineEntity?.kind === 'mine' ? String(mineEntity.resourceId) : 'ironOre';
    const mine = mineOf(before, fixture.ids.mine);
    const expected = new Map<string, number>();
    const bump = (resourceId: string, quantity: number): void => {
      expected.set(resourceId, (expected.get(resourceId) ?? 0) + quantity);
    };
    bump(oreId, mine.output.quantity);
    for (const item of [...mine.construction.items, ...mine.salvage.items])
      bump(String(item.resourceId), item.quantity);
    for (const item of worldContent.drill.buildCost)
      bump(
        String(item.resourceId),
        item.quantity * (mine.drills.active + mine.drills.exhausted),
      );
    for (const item of worldContent.buildings.find(
      (building) => building.kind === 'mine',
    )?.buildCost ?? [])
      bump(String(item.resourceId), item.quantity);
    const response = send({
      type: 'DISMANTLE_ENTITY',
      entityId: asId<WorldEntityId>(fixture.ids.mine),
    });
    expect(response.type).toBe('DELTA');
    const after = snapshotOf();
    // Its footprint remains reserved while recovered materials await pickup.
    expect(
      after.entities.find(
        (candidate) => candidate.id === asId<WorldEntityId>(fixture.ids.mine),
      ),
    ).toMatchObject({
      kind: 'mine',
      dismantling: true,
      canCancelDismantle: true,
    });
    expect(
      after.buildings.find(
        (building) => building.entityId === fixture.ids.mine,
      ),
    ).toBeUndefined();
    expect(salvageRows(after, fixture.ids.mine)).toEqual(
      expectedRows(expected),
    );
  });
});

describe('paused presentation and persistence (real worker)', () => {
  it('presents the paused world and retains it across save/load', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    let snapshot = snapshotOf();
    expect(snapshot.paused).toBe(true);
    expect(snapshot.timeScale).toBe(1);
    send({ type: 'SET_TIME_CONTROL', paused: false, timeScale: 5 });
    snapshot = snapshotOf();
    expect(snapshot.paused).toBe(false);
    expect(snapshot.timeScale).toBe(5);
    send({ type: 'SET_TIME_CONTROL', paused: true, timeScale: 1 });
    const saved = send({ type: 'SAVE' });
    if (saved.type !== 'SAVE_RESULT')
      throw new Error(`expected SAVE_RESULT, received ${saved.type}`);
    const loaded = send({ type: 'LOAD', state: saved.state });
    expect(loaded.type).toBe('READY');
    snapshot = snapshotOf();
    expect(snapshot.paused).toBe(true);
    expect(snapshot.timeScale).toBe(1);
  });

  it('keeps drill bindings across save/load without cursor mutations', () => {
    const fixture = createStatesFixture();
    loadFixture(fixture);
    const mineId = asId<WorldEntityId>(fixture.ids.mine);
    const before = snapshotOf();
    // Cursor/hover validation is side-effect free on domain state.
    for (const position of [
      fixture.tiles.chainFirst,
      fixture.tiles.chainSecond,
      fixture.tiles.disconnected,
      fixture.tiles.wrongOre,
      fixture.tiles.exhaustedOre,
    ])
      validationOf(drillInput(fixture, position));
    validationOf(mineHeadInput(fixture));
    const untouched = snapshotOf();
    expect(untouched.revision).toBe(before.revision);
    expect(untouched.entities).toEqual(before.entities);
    // The second drill chains onto the first and is accepted.
    const placed = send({
      type: 'PLACE_DRILL',
      mineId,
      position: fixture.tiles.chainFirst,
    });
    expect(placed.type).toBe('DELTA');
    // The real SAVE/LOAD round trip keeps every drill bound to its mine.
    const saved = send({ type: 'SAVE' });
    if (saved.type !== 'SAVE_RESULT')
      throw new Error(`expected SAVE_RESULT, received ${saved.type}`);
    const loaded = send({ type: 'LOAD', state: saved.state });
    expect(loaded.type).toBe('READY');
    const after = snapshotOf();
    const drills = after.entities.filter((entity) => entity.kind === 'drill');
    expect(drills.length).toBe(2);
    for (const drill of drills)
      expect(drill.kind === 'drill' ? drill.mineId : undefined).toBe(mineId);
  });
});
