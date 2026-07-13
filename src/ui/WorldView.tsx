import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  asId,
  formatRate,
  gridSize,
  parseExact,
  resourceById,
  resources,
  stringifyExact,
  worldContent,
} from '../domain';
import type {
  FactoryId,
  GridPoint,
  InstanceId,
  RailEdgeId,
  ResourceId,
} from '../domain';
import { serializeContract, type FactoryContract } from '../compiler';
import type { FactoryBlueprint } from '../editor';
import { database } from '../persistence';
import {
  occupiedCells,
  OreKind,
  TerrainKind,
  WorldClient,
  defaultWorldGenerationConfig,
  type QuarterTurn,
  type SerializedWorldState,
  type WorldClientResult,
  type WorldEntity,
  type WorldSnapshot,
  type WorldTool,
  type WorldTransform,
} from '../world';
import { railEdgeAt } from './worldRailVisual';
import { WORLD_SYNC_INTERVAL_MS } from './worldAnimation';
import { WorldBuildingInspector } from './WorldBuildingInspector';

const WorldCanvas = lazy(async () => ({
  default: (await import('./WorldCanvas')).WorldCanvas,
}));
interface Props {
  readonly blueprint: FactoryBlueprint;
  readonly factories: readonly {
    readonly id: FactoryId;
    readonly name: string;
  }[];
  readonly activeFactoryId: FactoryId;
  readonly factoryName: string;
  readonly contract: FactoryContract | undefined;
  readonly compileState: 'compiling' | 'ready' | 'invalid';
  readonly onSelectFactory: (factoryId: FactoryId) => void;
  readonly onOpenFactory: () => void;
}
const tools: readonly {
  readonly id: WorldTool;
  readonly label: string;
  readonly key: string;
}[] = [
  { id: 'select', label: 'Select', key: 'S' },
  { id: 'rail', label: 'Rail', key: 'T' },
  { id: 'rail-erase', label: 'Erase rail', key: 'X' },
  { id: 'junction', label: 'Junction', key: 'J' },
  { id: 'station', label: 'Station', key: 'G' },
  { id: 'factory', label: 'Factory', key: 'F' },
  { id: 'mine', label: 'Mine', key: 'M' },
  { id: 'drill', label: 'Drill', key: 'D' },
  { id: 'storage', label: 'Storage', key: 'B' },
  { id: 'depot', label: 'Depot', key: 'P' },
  { id: 'dismantle', label: 'Dismantle', key: 'C' },
];
const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
const entityAt = (
  snapshot: WorldSnapshot,
  point: GridPoint,
): WorldEntity | undefined =>
  snapshot.entities.find((entity) =>
    occupiedCells(entity.transform).some((cell) => samePoint(cell, point)),
  );
const adjacent = (a: WorldTransform, b: WorldTransform) =>
  occupiedCells(a).some((one) =>
    occupiedCells(b).some(
      (two) => Math.abs(one.x - two.x) + Math.abs(one.y - two.y) === 1,
    ),
  );

export const WorldView = ({
  factories,
  activeFactoryId,
  factoryName,
  contract,
  compileState,
  onSelectFactory,
  onOpenFactory,
}: Props) => {
  const clientRef = useRef<WorldClient | undefined>(undefined);
  const busyRef = useRef(false);
  const snapshotRef = useRef<WorldSnapshot | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<WorldSnapshot>();
  const [seed, setSeed] = useState('starter-world');
  const [selected, setSelected] = useState<GridPoint>();
  const [hovered, setHovered] = useState<GridPoint>();
  const [tool, setTool] = useState<WorldTool>('select');
  const [rotation, setRotation] = useState<QuarterTurn>(0);
  const [railDraft, setRailDraft] = useState<readonly GridPoint[]>([]);
  const [mineResource, setMineResource] = useState<ResourceId>(asId('ironOre'));
  const [ruleResource, setRuleResource] = useState<ResourceId>(
    asId('ironPlate'),
  );
  const [ruleMode, setRuleMode] = useState<'request' | 'provide'>('request');
  const [ruleTarget, setRuleTarget] = useState(50);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [selectedRailEdgeId, setSelectedRailEdgeId] = useState<RailEdgeId>();
  const acceptSnapshot = useCallback((next: WorldSnapshot) => {
    snapshotRef.current = next;
    startTransition(() => setSnapshot(next));
  }, []);
  const saveCurrent = useCallback(async (client: WorldClient) => {
    const saved = await client.save();
    if (saved.state !== undefined)
      await database.worlds.put({
        id: 'main',
        schemaVersion: 2,
        revision: saved.snapshot.revision,
        savedAt: new Date().toISOString(),
        payload: stringifyExact(saved.state),
      });
  }, []);
  const persist = useCallback(
    async (result: WorldClientResult) => {
      acceptSnapshot(result.snapshot);
      const client = clientRef.current;
      if (client !== undefined) await saveCurrent(client);
    },
    [acceptSnapshot, saveCurrent],
  );
  const run = useCallback(
    async (
      operation: (client: WorldClient) => Promise<WorldClientResult>,
      save = true,
    ) => {
      const client = clientRef.current;
      if (client === undefined || busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await operation(client);
        if (save) await persist(result);
        else acceptSnapshot(result.snapshot);
        return result;
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : 'World command failed',
        );
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [acceptSnapshot, persist],
  );
  useEffect(() => {
    const client = new WorldClient();
    clientRef.current = client;
    let active = true;
    const start = async () => {
      try {
        const stored = await database.worlds.get('main');
        let result: WorldClientResult;
        if (stored?.schemaVersion === 2) {
          result = await client.load(
            parseExact<SerializedWorldState>(stored.payload),
          );
          if (!result.snapshot.paused) {
            const elapsed = Math.max(
              0,
              Date.now() - Date.parse(stored.savedAt),
            );
            result = await client.advance(
              result.snapshot.logicalTime +
                BigInt(elapsed * 1000 * result.snapshot.timeScale),
            );
          }
        } else
          result = await client.generate(
            defaultWorldGenerationConfig('starter-world'),
          );
        if (active) await persist(result);
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'World initialisation failed',
          );
      } finally {
        if (active) {
          setBusy(false);
          busyRef.current = false;
        }
      }
    };
    void start();
    return () => {
      active = false;
      client.dispose();
      if (clientRef.current === client) clientRef.current = undefined;
    };
  }, [persist]);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let lastAdvanceAt = performance.now();
    let lastSaveAt = lastAdvanceAt;
    const schedule = (delay = WORLD_SYNC_INTERVAL_MS) => {
      if (active) timer = window.setTimeout(() => void pulse(), delay);
    };
    const pulse = async () => {
      const startedAt = performance.now();
      const client = clientRef.current;
      const current = snapshotRef.current;
      if (client === undefined || current === undefined || busyRef.current) {
        schedule();
        return;
      }
      if (current.paused) {
        lastAdvanceAt = startedAt;
        schedule();
        return;
      }
      try {
        let result: WorldClientResult;
        if (current.pendingAdvanceTarget !== undefined)
          result = await client.continueAdvance();
        else {
          const elapsedMs = Math.max(0, startedAt - lastAdvanceAt);
          lastAdvanceAt = startedAt;
          result = await client.advance(
            current.logicalTime +
              BigInt(Math.floor(elapsedMs * 1000 * current.timeScale)),
          );
        }
        if (!active) return;
        acceptSnapshot(result.snapshot);
        if (performance.now() - lastSaveAt >= 1000) {
          lastSaveAt = performance.now();
          void saveCurrent(client).catch((reason: unknown) => {
            if (active)
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'World autosave failed',
              );
          });
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'World clock synchronisation failed',
          );
      }
      const elapsed = performance.now() - startedAt;
      schedule(Math.max(0, WORLD_SYNC_INTERVAL_MS - elapsed));
    };
    schedule();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [acceptSnapshot, saveCurrent]);

  const transformFor = useCallback(
    (activeTool: WorldTool, point: GridPoint): WorldTransform | undefined => {
      if (activeTool === 'factory') {
        if (contract === undefined) return undefined;
        return {
          position: point,
          size: gridSize(contract.footprint.width, contract.footprint.height),
          rotation,
        };
      }
      if (
        activeTool === 'mine' ||
        activeTool === 'storage' ||
        activeTool === 'depot'
      )
        return { position: point, size: gridSize(4, 4), rotation };
      if (activeTool === 'drill' || activeTool === 'junction')
        return { position: point, size: gridSize(1, 1), rotation: 0 };
      if (activeTool === 'station')
        return {
          position: point,
          size: worldContent.stationFootprint,
          rotation: 0,
        };
      return undefined;
    },
    [contract, rotation],
  );
  const stationFor = useCallback(
    (
      transform: WorldTransform,
    ): Extract<WorldEntity, { kind: 'station' }> | undefined =>
      snapshot?.entities
        .filter(
          (entity): entity is Extract<WorldEntity, { kind: 'station' }> =>
            entity.kind === 'station' && entity.linkedEntityId === undefined,
        )
        .find((station) => adjacent(transform, station.transform)),
    [snapshot],
  );
  const selectedEntity =
    snapshot === undefined || selected === undefined
      ? undefined
      : entityAt(snapshot, selected);
  const drillMineFor = useCallback(
    (point: GridPoint) => {
      if (snapshot === undefined) return undefined;
      const index = point.y * snapshot.grid.width + point.x;
      const oreKind = snapshot.grid.oreKinds[index];
      if (
        snapshot.grid.oreRemaining[index] === 0 ||
        (oreKind !== OreKind.IRON && oreKind !== OreKind.COPPER)
      )
        return undefined;
      return snapshot.entities
        .filter(
          (entity): entity is Extract<WorldEntity, { kind: 'mine' }> =>
            entity.kind === 'mine' &&
            (entity.resourceId === asId<ResourceId>('ironOre')
              ? oreKind === OreKind.IRON
              : oreKind === OreKind.COPPER),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .find((mine) =>
          snapshot.entities.some((entity) => {
            if (
              entity.id !== mine.id &&
              (entity.kind !== 'drill' || entity.mineId !== mine.id)
            )
              return false;
            return occupiedCells(entity.transform).some(
              (cell) =>
                Math.abs(cell.x - point.x) + Math.abs(cell.y - point.y) === 1,
            );
          }),
        );
    },
    [snapshot],
  );
  const localValidity = useCallback(
    (transform: WorldTransform, activeTool: WorldTool): boolean => {
      if (snapshot === undefined) return false;
      for (const cell of occupiedCells(transform)) {
        if (
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= snapshot.grid.width ||
          cell.y >= snapshot.grid.height
        )
          return false;
        const index = cell.y * snapshot.grid.width + cell.x;
        if (
          snapshot.grid.terrain[index] === TerrainKind.OBSTACLE ||
          snapshot.grid.occupancy[index] !== 0
        )
          return false;
      }
      if (
        ['factory', 'mine', 'storage', 'depot'].includes(activeTool) &&
        stationFor(transform) === undefined
      )
        return false;
      if (
        activeTool === 'mine' &&
        occupiedCells(transform).some(
          (cell) =>
            snapshot.grid.oreKinds[cell.y * snapshot.grid.width + cell.x] !==
            OreKind.NONE,
        )
      )
        return false;
      if (activeTool === 'drill') {
        if (drillMineFor(transform.position) === undefined) return false;
      }
      return true;
    },
    [drillMineFor, snapshot, stationFor],
  );
  const ghostTransform =
    hovered === undefined ? undefined : transformFor(tool, hovered);
  const ghost =
    ghostTransform === undefined
      ? undefined
      : {
          transform: ghostTransform,
          valid: localValidity(ghostTransform, tool),
        };
  const hoveredRailEdgeId =
    tool === 'rail-erase' && snapshot !== undefined && hovered !== undefined
      ? railEdgeAt(snapshot, hovered)?.id
      : undefined;
  const hoveredDismantleEntityId =
    tool === 'dismantle' && snapshot !== undefined && hovered !== undefined
      ? entityAt(snapshot, hovered)?.id
      : undefined;
  const selectedRailEdge =
    selectedRailEdgeId === undefined || snapshot === undefined
      ? undefined
      : snapshot.railEdges.find((e) => e.id === selectedRailEdgeId);

  const commitRail = useCallback(
    async (points: readonly GridPoint[]) => {
      setRailDraft([]);
      await run((client) =>
        client.command({ type: 'PLACE_RAIL_PATH', points }),
      );
    },
    [run],
  );
  const handleMapClick = useCallback(
    async (point: GridPoint) => {
      setSelected(point);
      setSelectedRailEdgeId(undefined);
      if (tool === 'select') {
        if (snapshot !== undefined) {
          const railEdge = railEdgeAt(snapshot, point);
          if (railEdge !== undefined) setSelectedRailEdgeId(railEdge.id);
        }
        return;
      }
      if (tool === 'rail') {
        return;
      }
      if (tool === 'rail-erase') {
        const edge =
          snapshot === undefined ? undefined : railEdgeAt(snapshot, point);
        if (edge === undefined) {
          setError('No rail segment on this tile.');
          return;
        }
        await run((client) =>
          client.command({ type: 'REMOVE_RAIL_EDGE', edgeId: edge.id }),
        );
        return;
      }
      if (tool === 'dismantle') {
        const target =
          snapshot === undefined ? undefined : entityAt(snapshot, point);
        if (
          target === undefined ||
          target.kind === 'station' ||
          target.kind === 'construction-site' ||
          target.kind === 'drill'
        ) {
          setError(
            'Select a dismantleable building (factory, mine, storage, or depot).',
          );
          return;
        }
        if (
          !window.confirm(
            `Dismantle this ${target.kind}? All contents will be salvaged via the logistics network.`,
          )
        )
          return;
        await run((client) =>
          client.command({ type: 'DISMANTLE_ENTITY', entityId: target.id }),
        );
        return;
      }
      if (tool === 'junction' || tool === 'station') {
        await run((client) =>
          client.command({
            type: 'PLACE_CONTROL_NODE',
            kind: tool,
            position: point,
          }),
        );
        return;
      }
      if (tool === 'drill') {
        const mine = drillMineFor(point);
        if (mine === undefined) {
          const touching = snapshot?.entities.filter((entity) =>
            occupiedCells(entity.transform).some(
              (cell) =>
                Math.abs(cell.x - point.x) + Math.abs(cell.y - point.y) === 1,
            ),
          );
          const unfinishedMine = touching?.find(
            (entity) =>
              entity.kind === 'construction-site' &&
              entity.targetKind === 'mine',
          );
          const wrongMine = touching?.find(
            (entity): entity is Extract<WorldEntity, { kind: 'mine' }> =>
              entity.kind === 'mine',
          );
          if (unfinishedMine !== undefined)
            setError('The adjacent mine is still under construction.');
          else if (wrongMine !== undefined)
            setError(
              `The adjacent mine extracts ${wrongMine.resourceId === asId<ResourceId>('ironOre') ? 'iron' : 'copper'}, which does not match this ore tile.`,
            );
          else
            setError(
              'The drill must touch a matching mine or one of its connected drills.',
            );
          return;
        }
        await run((client) =>
          client.command({
            type: 'PLACE_DRILL',
            mineId: mine.id,
            position: point,
          }),
        );
        return;
      }
      const transform = transformFor(tool, point);
      if (transform === undefined) return;
      const station = stationFor(transform);
      if (station === undefined) {
        setError('Place one free adjacent station first.');
        return;
      }
      const targetKind = tool as 'factory' | 'mine' | 'storage' | 'depot';
      const validation = await run(
        (client) =>
          client.command({
            type: 'VALIDATE_GHOST',
            targetKind,
            position: transform.position,
            size: transform.size,
            rotation: transform.rotation,
            stationId: station.stationId,
            ...(targetKind === 'mine' ? { resourceId: mineResource } : {}),
          }),
        false,
      );
      if (validation?.validation?.valid !== true) {
        setError(
          `Invalid ghost: ${validation?.validation?.reason ?? 'worker rejected placement'}`,
        );
        return;
      }
      await run((client) =>
        client.command({
          type: 'CREATE_SITE',
          targetKind,
          position: transform.position,
          size: transform.size,
          rotation: transform.rotation,
          stationId: station.stationId,
          ...(targetKind === 'factory' && contract !== undefined
            ? {
                cost: contract.billOfMaterials ?? [],
                factoryId: activeFactoryId,
                instanceId: asId<InstanceId>(`instance-${Date.now()}`),
                contract: serializeContract(contract),
              }
            : {}),
          ...(targetKind === 'mine' ? { resourceId: mineResource } : {}),
        }),
      );
    },
    [
      activeFactoryId,
      contract,
      mineResource,
      drillMineFor,
      run,
      snapshot,
      stationFor,
      tool,
      transformFor,
    ],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const found = tools.find(
        (item) => item.key.toLowerCase() === event.key.toLowerCase(),
      );
      if (found !== undefined) {
        setTool(found.id);
        setRailDraft([]);
        return;
      }
      if (event.key.toLowerCase() === 'r')
        setRotation((value) => ((value + 1) % 4) as QuarterTurn);
      else if (event.key === 'Escape') {
        setRailDraft([]);
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedRailEdgeId !== undefined) {
          event.preventDefault();
          if (window.confirm('Remove this rail segment?'))
            void run((client) =>
              client.command({
                type: 'REMOVE_RAIL_EDGE',
                edgeId: selectedRailEdgeId,
              }),
            );
        } else if (selectedEntity !== undefined) {
          const kind = selectedEntity.kind;
          if (
            kind === 'factory' ||
            kind === 'mine' ||
            kind === 'storage' ||
            kind === 'depot'
          ) {
            event.preventDefault();
            if (window.confirm(`Dismantle this ${kind}?`))
              void run((client) =>
                client.command({
                  type: 'DISMANTLE_ENTITY',
                  entityId: selectedEntity.id,
                }),
              );
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, selectedEntity, selectedRailEdgeId]);

  const regenerate = async () => {
    if (
      snapshot !== undefined &&
      !window.confirm(
        'Generate a new world? The current world will be replaced only after generation succeeds.',
      )
    )
      return;
    const result = await run((client) =>
      client.generate(
        defaultWorldGenerationConfig(seed.trim() || 'starter-world'),
      ),
    );
    if (result !== undefined) {
      setSelected(undefined);
      setRailDraft([]);
    }
  };
  const setTime = async (
    paused: boolean,
    timeScale = snapshot?.timeScale ?? 1,
  ) => {
    await run((client) =>
      client.command({ type: 'SET_TIME_CONTROL', paused, timeScale }),
    );
  };
  const selectedIndex =
    snapshot === undefined || selected === undefined
      ? -1
      : selected.y * snapshot.grid.width + selected.x;
  const selectedDescription = useMemo(() => {
    if (snapshot === undefined || selectedIndex < 0) return undefined;
    const ore = snapshot.grid.oreKinds[selectedIndex];
    return {
      terrain:
        snapshot.grid.terrain[selectedIndex] === TerrainKind.OBSTACLE
          ? 'Obstacle'
          : 'Buildable ground',
      ore:
        ore === OreKind.IRON
          ? 'Iron ore'
          : ore === OreKind.COPPER
            ? 'Copper ore'
            : undefined,
      amount: snapshot.grid.oreRemaining[selectedIndex] ?? 0,
    };
  }, [selectedIndex, snapshot]);
  const contractRows =
    contract === undefined
      ? []
      : [
          ...[...contract.inputRates].map(([resourceId, rate]) => ({
            role: 'input' as const,
            resourceId,
            rate,
            maximum: contract.inputPorts
              .filter((port) => port.resourceId === resourceId)
              .reduce((total, port) => total + port.capacity, 0n),
          })),
          ...[...contract.outputRates].map(([resourceId, rate]) => ({
            role: 'output' as const,
            resourceId,
            rate,
            maximum: contract.outputPorts
              .filter((port) => port.resourceId === resourceId)
              .reduce((total, port) => total + port.capacity, 0n),
          })),
        ];
  return (
    <div className="world-workspace world-workspace--map">
      <aside className="world-sites panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">World editor</span>
            <h2>Build tools</h2>
          </div>
          <span>{snapshot?.revision ?? 0}</span>
        </div>
        <div
          className="world-tool-grid"
          role="toolbar"
          aria-label="World build tools"
        >
          {tools.map((item) => (
            <button
              key={item.id}
              aria-pressed={tool === item.id}
              className={tool === item.id ? 'is-active' : ''}
              onClick={() => {
                setTool(item.id);
                setRailDraft([]);
              }}
            >
              {item.label}
              <kbd>{item.key}</kbd>
            </button>
          ))}
        </div>
        {tool === 'rail' && (
          <div className="world-tool-options">
            <p>Drag to place a straight directed rail. Space + drag to pan.</p>
          </div>
        )}
        {tool === 'rail-erase' && (
          <div className="world-tool-options">
            <p>Hover a segment to highlight it, then click to remove it.</p>
          </div>
        )}
        {tool === 'dismantle' && (
          <div className="world-tool-options">
            <p>
              Click on a factory, mine, storage, or depot to dismantle it.
              Contents will be salvaged via rail.
            </p>
          </div>
        )}
        {(tool === 'rail' || tool === 'rail-erase') && (
          <div
            className="world-rail-legend"
            aria-label="Rail connection legend"
          >
            <span>
              <i className="connected" />
              Directed rail
            </span>
            <span>
              <i className="disconnected" />
              Open end
            </span>
          </div>
        )}
        <div className="world-tool-options">
          <button
            onClick={() =>
              setRotation((value) => ((value + 1) % 4) as QuarterTurn)
            }
          >
            Rotate · {rotation * 90}° <kbd>R</kbd>
          </button>
          {tool === 'mine' && (
            <select
              aria-label="Mine resource"
              value={mineResource}
              onChange={(event) =>
                setMineResource(asId<ResourceId>(event.target.value))
              }
            >
              <option value="ironOre">Iron ore</option>
              <option value="copperOre">Copper ore</option>
            </select>
          )}
        </div>
        <div className="world-site-list">
          {factories.map((factory, index) => (
            <button
              key={factory.id}
              aria-label={`View ${factory.name} in world`}
              aria-pressed={factory.id === activeFactoryId}
              className={`world-site ${factory.id === activeFactoryId ? 'is-active' : ''}`}
              onClick={() => onSelectFactory(factory.id)}
            >
              <span className="world-site-mark">F{index + 1}</span>
              <span>
                <strong>{factory.name}</strong>
                <small>
                  {factory.id === activeFactoryId
                    ? 'Placement definition'
                    : 'Choose definition'}
                </small>
              </span>
            </button>
          ))}
        </div>
        <section className="world-summary">
          <dl>
            <div>
              <dt>Entities</dt>
              <dd>{snapshot?.entities.length ?? 0}</dd>
            </div>
            <div>
              <dt>Pods</dt>
              <dd>{snapshot?.pods.length ?? 0}</dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{snapshot?.scheduledEvents ?? 0}</dd>
            </div>
          </dl>
        </section>
      </aside>
      <section
        className="world-map world-map--pixi"
        aria-label="World overview"
      >
        {snapshot === undefined ? (
          <div className="world-loading">
            {error ?? 'Generating deterministic world…'}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="world-loading">Loading WebGL renderer…</div>
            }
          >
            <WorldCanvas
              snapshot={snapshot}
              {...(selected === undefined ? {} : { selected })}
              {...(ghost === undefined ? {} : { ghost })}
              {...(hoveredRailEdgeId === undefined
                ? {}
                : { hoveredRailEdgeId })}
              {...(hoveredDismantleEntityId === undefined
                ? {}
                : { hoveredDismantleEntityId })}
              {...(selectedRailEdgeId === undefined
                ? {}
                : { selectedRailEdgeId })}
              railDraft={railDraft}
              railPlacement={tool === 'rail'}
              onSelect={(point) => void handleMapClick(point)}
              onHover={setHovered}
              onRailPreview={setRailDraft}
              onRailPlace={(points) => void commitRail(points)}
            />
          </Suspense>
        )}
        <div className="world-map-caption">
          <span>{tool} tool</span>
          <small>Seed {seed} · pan, wheel to zoom, click to edit</small>
        </div>
      </section>
      <aside className="world-inspector panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Operate</span>
            <h2>World runtime</h2>
          </div>
          <span
            className={`badge ${compileState === 'ready' ? 'good' : 'waiting'}`}
          >
            {compileState}
          </span>
        </div>
        {error !== undefined && (
          <p className="world-error" role="alert">
            {error}
          </p>
        )}
        <section className="inspector-card">
          <h3>World seed</h3>
          <label className="world-seed">
            <span>Seed</span>
            <input
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
          <button
            className="button button--primary button--block"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            Generate new world
          </button>
        </section>
        <section className="inspector-card">
          <h3>Logical clock</h3>
          <dl>
            <div>
              <dt>Time</dt>
              <dd>{Number(snapshot?.logicalTime ?? 0n) / 1_000_000}s</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>
                {snapshot?.paused === false
                  ? `${snapshot.timeScale}×`
                  : 'Paused'}
              </dd>
            </div>
          </dl>
          <div className="world-time-controls">
            <button
              aria-label={
                snapshot?.paused === false ? 'Pause world' : 'Play world'
              }
              onClick={() => void setTime(snapshot?.paused === false)}
            >
              {snapshot?.paused === false ? 'Pause' : 'Play'}
            </button>
            {([1, 5, 20] as const).map((speed) => (
              <button
                key={speed}
                aria-pressed={snapshot?.timeScale === speed}
                onClick={() => void setTime(false, speed)}
              >
                {speed}×
              </button>
            ))}
          </div>
          {snapshot?.pendingAdvanceTarget !== undefined && (
            <button
              onClick={() => void run((client) => client.continueAdvance())}
            >
              Continue catch-up
            </button>
          )}
        </section>
        {selected !== undefined && selectedDescription !== undefined && (
          <section className="inspector-card">
            <h3>
              Tile {selected.x}, {selected.y}
            </h3>
            <dl>
              <div>
                <dt>Terrain</dt>
                <dd>{selectedDescription.terrain}</dd>
              </div>
              {selectedDescription.ore !== undefined && (
                <>
                  <div>
                    <dt>Deposit</dt>
                    <dd>{selectedDescription.ore}</dd>
                  </div>
                  <div>
                    <dt>Remaining</dt>
                    <dd>{selectedDescription.amount}</dd>
                  </div>
                </>
              )}
            </dl>
          </section>
        )}
        {selectedRailEdge !== undefined && (
          <section className="inspector-card">
            <h3>Rail segment</h3>
            <dl>
              <div>
                <dt>Length</dt>
                <dd>{selectedRailEdge.length}</dd>
              </div>
              <div>
                <dt>From</dt>
                <dd>{selectedRailEdge.from}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>{selectedRailEdge.to}</dd>
              </div>
            </dl>
            <button
              className="danger-button"
              onClick={() => {
                if (window.confirm('Remove this rail segment?'))
                  void run((client) =>
                    client.command({
                      type: 'REMOVE_RAIL_EDGE',
                      edgeId: selectedRailEdge.id,
                    }),
                  );
              }}
            >
              Remove rail
            </button>
          </section>
        )}
        {selectedEntity !== undefined && snapshot !== undefined && (
          <section className="inspector-card world-building-card">
            <h3>Selected {selectedEntity.kind}</h3>
            <WorldBuildingInspector
              entity={selectedEntity}
              snapshot={snapshot}
              busy={busy}
              onQueuePod={() =>
                void run((client) =>
                  client.command({
                    type: 'QUEUE_POD_PRODUCTION',
                    depotId: selectedEntity.id,
                  }),
                )
              }
              onCancelPod={() =>
                void run((client) =>
                  client.command({
                    type: 'CANCEL_POD_PRODUCTION',
                    depotId: selectedEntity.id,
                  }),
                )
              }
            />
            {(selectedEntity.kind === 'factory' ||
              selectedEntity.kind === 'mine' ||
              selectedEntity.kind === 'storage' ||
              selectedEntity.kind === 'depot') && (
              <button
                className="danger-button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Dismantle this ${selectedEntity.kind}? All contents will be salvaged via the logistics network.`,
                    )
                  )
                    void run((client) =>
                      client.command({
                        type: 'DISMANTLE_ENTITY',
                        entityId: selectedEntity.id,
                      }),
                    );
                }}
              >
                Dismantle
              </button>
            )}
            {selectedEntity.kind === 'construction-site' && (
              <button
                className="danger-button"
                onClick={() =>
                  void run((client) =>
                    client.command({
                      type: 'CANCEL_CONSTRUCTION',
                      siteId: selectedEntity.id,
                    }),
                  )
                }
              >
                Cancel and evacuate
              </button>
            )}
            {selectedEntity.kind === 'storage' && (
              <div className="world-rule-editor">
                <h4>New logistics rule</h4>
                <select
                  aria-label="Rule resource"
                  value={ruleResource}
                  onChange={(event) =>
                    setRuleResource(asId<ResourceId>(event.target.value))
                  }
                >
                  {resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Rule mode"
                  value={ruleMode}
                  onChange={(event) =>
                    setRuleMode(event.target.value as 'request' | 'provide')
                  }
                >
                  <option value="request">Request</option>
                  <option value="provide">Provide</option>
                </select>
                <input
                  aria-label="Rule target"
                  type="number"
                  min="0"
                  value={ruleTarget}
                  onChange={(event) =>
                    setRuleTarget(Number(event.target.value))
                  }
                />
                <button
                  onClick={() =>
                    void run((client) =>
                      client.command({
                        type: 'CONFIGURE_STATION',
                        entityId: selectedEntity.id,
                        resourceId: ruleResource,
                        mode: ruleMode,
                        target: ruleTarget,
                        priority: 0,
                      }),
                    )
                  }
                >
                  Apply rule
                </button>
              </div>
            )}
          </section>
        )}
        <section className="inspector-card world-contract">
          <h3>{factoryName}</h3>
          <p>
            {contract === undefined
              ? 'Compile the blueprint before placing it.'
              : `${contract.footprint.width} × ${contract.footprint.height} tiles · ${contract.billOfMaterials?.reduce((sum, item) => sum + item.quantity, 0) ?? 0} build items.`}
          </p>
          {contractRows.map((row) => (
            <div
              className="world-contract-row"
              key={`${row.role}-${row.resourceId}`}
            >
              <span>Contract rate</span>
              <strong>
                {resourceById.get(row.resourceId)?.name ?? row.resourceId}
              </strong>
              <b>{formatRate(row.rate)}/s</b>
              <small>max {formatRate(row.maximum)}/s</small>
            </div>
          ))}
          <button
            aria-label={`Open ${factoryName} factory`}
            className="button button--block"
            onClick={onOpenFactory}
          >
            Open factory blueprint
          </button>
        </section>
        <section className="inspector-card">
          <h3>Accessible entities</h3>
          <ul className="world-entity-list">
            {snapshot?.entities.map((entity) => (
              <li key={entity.id}>
                <button onClick={() => setSelected(entity.transform.position)}>
                  {entity.kind} · {entity.id}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="inspector-card">
          <h3>Traffic diagnostics</h3>
          {snapshot?.diagnostics.length === 0 ? (
            <p>No blocking cycle.</p>
          ) : (
            snapshot?.diagnostics.map((diagnostic) => (
              <p key={`${diagnostic.code}-${diagnostic.entityIds.join('-')}`}>
                {diagnostic.message}
              </p>
            ))
          )}
        </section>
      </aside>
    </div>
  );
};
