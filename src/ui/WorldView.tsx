import { StockRules } from './StockRules';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  asId,
  formatRate,
  gridSize,
  resourceById,
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
import type { WorldSession } from '../application/world/WorldSession';
import {
  occupiedCells,
  validateRailPath,
  OreKind,
  TerrainKind,
  defaultWorldGenerationConfig,
  type QuarterTurn,
  type WorldEntity,
  type WorldSnapshot,
  type WorldTool,
  type WorldTransform,
  type WorldValidationResult,
} from '../world';
import { hookupCell } from '../world';
import { railEdgeAt, railEdgesAt } from './worldRailVisual';
import { WorldBuildingInspector } from './WorldBuildingInspector';
import { WorldThumbnail } from './WorldThumbnail';

const WorldCanvas = lazy(async () => ({
  default: (await import('./WorldCanvas')).WorldCanvas,
}));
interface Props {
  readonly hidden?: boolean;
  readonly session: WorldSession;
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
  readonly onOpenFactory: (factoryId?: FactoryId) => void;
}
const tools: readonly {
  readonly id: WorldTool;
  readonly label: string;
  readonly key: string;
}[] = [
  { id: 'select', label: 'Select', key: 'S' },
  { id: 'rail', label: 'Rail', key: 'T' },
  { id: 'rail-erase', label: 'Remove rail', key: 'X' },
  { id: 'junction', label: 'Rail junction', key: 'J' },
  { id: 'station', label: 'Station', key: 'G' },
  { id: 'factory', label: 'Factory', key: 'F' },
  { id: 'mine', label: 'Mine', key: 'M' },
  { id: 'drill', label: 'Drill', key: 'D' },
  { id: 'storage', label: 'Storage', key: 'B' },
  { id: 'depot', label: 'Depot', key: 'P' },
  { id: 'dismantle', label: 'Dismantle', key: 'C' },
];
const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
const HIDDEN_RENDERER_RELEASE_DELAY_MS = 30_000;
const entityAt = (
  snapshot: WorldSnapshot,
  point: GridPoint,
): WorldEntity | undefined =>
  snapshot.entities.find((entity) =>
    occupiedCells(entity.transform).some((cell) => samePoint(cell, point)),
  );
const isEntityDismantling = (entity: WorldEntity): boolean =>
  entity.kind === 'factory'
    ? entity.state === 'DISMANTLING'
    : (entity.kind === 'mine' ||
        entity.kind === 'storage' ||
        entity.kind === 'depot') &&
      entity.dismantling === true;
const adjacent = (a: WorldTransform, b: WorldTransform) =>
  occupiedCells(a).some((one) =>
    occupiedCells(b).some(
      (two) => Math.abs(one.x - two.x) + Math.abs(one.y - two.y) === 1,
    ),
  );

export const WorldView = ({
  hidden = false,
  session,
  factories,
  activeFactoryId,
  factoryName,
  contract,
  compileState,
  onSelectFactory,
  onOpenFactory,
}: Props) => {
  const sessionState = useSyncExternalStore(
    session.store.subscribe,
    session.store.getSnapshot,
  );
  const [rendererReleased, setRendererReleased] = useState(false);
  const [previousHidden, setPreviousHidden] = useState(hidden);
  if (previousHidden !== hidden) {
    setPreviousHidden(hidden);
    if (!hidden && rendererReleased) setRendererReleased(false);
  }
  const { snapshot, workerFailed, saveState, busy } = sessionState;
  // Keep grid buffers out of React's development prop-diff serialization.
  const getSnapshot = useCallback(() => {
    if (!snapshot) throw new Error('World is loading.');
    return snapshot;
  }, [snapshot]);
  const run = session.run;
  const [seed, setSeed] = useState('starter-world');
  const [selected, setSelected] = useState<GridPoint>();
  const [selectedEntityId, setSelectedEntityId] = useState<WorldEntity['id']>();
  const [selectedPodId, setSelectedPodId] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showObjectBrowser, setShowObjectBrowser] = useState(false);
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [boundMineId, setBoundMineId] = useState<WorldEntity['id']>();
  const [confirmation, setConfirmation] = useState<{
    readonly title: string;
    readonly message: string;
    readonly confirmText: string;
    readonly action: () => Promise<void>;
  }>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<GridPoint>();
  const [tool, setTool] = useState<WorldTool>('select');
  const [rotation, setRotation] = useState<QuarterTurn>(0);
  const [mineResource, setMineResource] = useState<ResourceId>(asId('ironOre'));
  const [interactionError, setError] = useState<string>();
  const error = interactionError ?? sessionState.error;
  const [selectedRailEdgeId, setSelectedRailEdgeId] = useState<RailEdgeId>();
  const [railCandidateEdges, setRailCandidateEdges] = useState<
    readonly RailEdgeId[]
  >([]);
  const [cameraFocus, setCameraFocus] = useState<GridPoint>();
  useEffect(() => {
    if (!hidden) return undefined;
    const timeout = window.setTimeout(() => {
      setCameraFocus(undefined);
      setRendererReleased(true);
    }, HIDDEN_RENDERER_RELEASE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [hidden]);
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
        return {
          position: point,
          size: worldContent.buildings.find(
            (entry) => entry.kind === activeTool,
          )!.footprint,
          rotation,
        };
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
  const effectiveBoundMineId = snapshot?.entities.some(
    (entity) => entity.id === boundMineId && entity.kind === 'mine',
  )
    ? boundMineId
    : undefined;
  const localValidation = useCallback(
    (
      transform: WorldTransform,
      activeTool: WorldTool,
    ): { valid: boolean; reason?: string } => {
      if (!snapshot) return { valid: false, reason: 'World is loading.' };
      for (const cell of occupiedCells(transform)) {
        if (
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= snapshot.grid.width ||
          cell.y >= snapshot.grid.height
        )
          return { valid: false, reason: 'Outside the world boundary.' };
        if (activeTool === 'junction') continue;
        const index = cell.y * snapshot.grid.width + cell.x;
        if (snapshot.grid.terrain[index] === TerrainKind.OBSTACLE)
          return {
            valid: false,
            reason: 'Rock obstacles block this footprint.',
          };
        if (snapshot.grid.occupancy[index] !== 0)
          return {
            valid: false,
            reason: 'Another building occupies this footprint.',
          };
      }
      if (activeTool === 'factory' && (compileState !== 'ready' || !contract))
        return {
          valid: false,
          reason: 'Wait for a valid compilation of the current factory draft.',
        };
      if (
        ['factory', 'mine', 'storage'].includes(activeTool) &&
        !stationFor(transform)
      )
        return {
          valid: false,
          reason:
            'A free adjacent station is required for construction deliveries.',
        };
      if (
        activeTool === 'mine' &&
        occupiedCells(transform).some(
          (cell) =>
            snapshot.grid.oreKinds[cell.y * snapshot.grid.width + cell.x] !==
            OreKind.NONE,
        )
      )
        return {
          valid: false,
          reason:
            'Keep the mine head outside the ore patch; drills sit on the ore.',
        };
      if (activeTool === 'mine') {
        const mineOre =
          mineResource === asId<ResourceId>('ironOre')
            ? OreKind.IRON
            : mineResource === asId<ResourceId>('copperOre')
              ? OreKind.COPPER
              : undefined;
        if (mineOre === undefined)
          return {
            valid: false,
            reason: 'Choose iron ore or copper ore for this mine.',
          };
        const mineOreName = mineOre === OreKind.IRON ? 'iron' : 'copper';
        const touchesSelectedOre = occupiedCells(transform).some((cell) =>
          [
            { x: cell.x + 1, y: cell.y },
            { x: cell.x - 1, y: cell.y },
            { x: cell.x, y: cell.y + 1 },
            { x: cell.x, y: cell.y - 1 },
          ].some((point) => {
            if (
              point.x < 0 ||
              point.y < 0 ||
              point.x >= snapshot.grid.width ||
              point.y >= snapshot.grid.height
            )
              return false;
            const index = point.y * snapshot.grid.width + point.x;
            return (
              snapshot.grid.oreKinds[index] === mineOre &&
              snapshot.grid.oreRemaining[index] !== 0
            );
          }),
        );
        if (!touchesSelectedOre)
          return {
            valid: false,
            reason:
              `No non-exhausted ${mineOreName} ore touches this mine footprint. ` +
              'Select the matching ore or move the head against its patch.',
          };
      }
      if (activeTool === 'drill') {
        const mine = snapshot.entities.find(
          (entity) =>
            entity.id === effectiveBoundMineId && entity.kind === 'mine',
        );
        if (!mine || mine.kind !== 'mine')
          return {
            valid: false,
            reason: 'Select a mine before placing its drill chain.',
          };
        const index =
          transform.position.y * snapshot.grid.width + transform.position.x;
        const ore =
          mine.resourceId === asId<ResourceId>('ironOre')
            ? OreKind.IRON
            : OreKind.COPPER;
        if (snapshot.grid.oreKinds[index] !== ore)
          return {
            valid: false,
            reason: 'The deposit must match the selected mine resource.',
          };
        if (snapshot.grid.oreRemaining[index] === 0)
          return { valid: false, reason: 'This deposit is exhausted.' };
        const touches = snapshot.entities.some(
          (entity) =>
            (entity.id === mine.id ||
              (entity.kind === 'drill' && entity.mineId === mine.id)) &&
            adjacent(entity.transform, transform),
        );
        if (!touches)
          return {
            valid: false,
            reason: 'Drills must touch the selected mine or its drill chain.',
          };
      }
      if (activeTool === 'junction') {
        const node = snapshot.railNodes.find((node) =>
          samePoint(node.position, transform.position),
        );
        if (node && !['endpoint', 'junction'].includes(node.kind))
          return {
            valid: false,
            reason: 'This rail control point is already in use.',
          };
      }
      if (activeTool === 'station' || activeTool === 'depot') {
        const cell = hookupCell(transform);
        const index = cell.y * snapshot.grid.width + cell.x;
        const outOfBounds =
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= snapshot.grid.width ||
          cell.y >= snapshot.grid.height;
        const blocked =
          outOfBounds ||
          snapshot.grid.terrain[index] === TerrainKind.OBSTACLE ||
          snapshot.grid.occupancy[index] !== 0 ||
          snapshot.railNodes.some(
            (node) =>
              samePoint(node.position, cell) && node.kind !== 'endpoint',
          ) ||
          snapshot.entities.some(
            (entity) =>
              entity.kind === 'construction-site' &&
              entity.targetKind === 'depot' &&
              samePoint(hookupCell(entity.transform), cell),
          );
        if (blocked)
          return { valid: false, reason: 'The rail hookup cell is blocked.' };
      }
      return { valid: true };
    },
    [
      snapshot,
      compileState,
      contract,
      stationFor,
      effectiveBoundMineId,
      mineResource,
    ],
  );
  const ghostTransform =
    hovered === undefined ? undefined : transformFor(tool, hovered);
  const localResult = ghostTransform
    ? localValidation(ghostTransform, tool)
    : undefined;
  const ghostKey = ghostTransform
    ? JSON.stringify([
        sessionState.generation,
        tool,
        ghostTransform,
        effectiveBoundMineId,
        mineResource,
        contract?.blueprintHash,
        compileState,
        stationFor(ghostTransform)?.stationId,
      ])
    : '';
  const [validatedGhost, setValidatedGhost] = useState<{
    key: string;
    result: WorldValidationResult;
  }>();
  useEffect(() => {
    if (
      !ghostTransform ||
      !localResult?.valid ||
      ![
        'factory',
        'mine',
        'storage',
        'depot',
        'drill',
        'station',
        'junction',
      ].includes(tool)
    )
      return;
    const station = stationFor(ghostTransform);
    if (!station && ['factory', 'mine', 'storage'].includes(tool)) return;
    return session.validateLatest(
      {
        type: 'VALIDATE_GHOST',
        targetKind: tool as
          | 'factory'
          | 'mine'
          | 'storage'
          | 'depot'
          | 'drill'
          | 'station'
          | 'junction',
        position: ghostTransform.position,
        size: ghostTransform.size,
        rotation: ghostTransform.rotation,
        ...(tool !== 'depot' && station
          ? { stationId: station.stationId }
          : {}),
        ...(effectiveBoundMineId ? { mineId: effectiveBoundMineId } : {}),
        ...(tool === 'mine' ? { resourceId: mineResource } : {}),
      },
      (result) => {
        if (result.validation && result.validationRevision !== undefined)
          setValidatedGhost({
            key: ghostKey,
            result: result.validation,
          });
      },
    );
    // The intent key includes every command input; a new accepted revision invalidates the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostKey, snapshot?.revision, localResult?.valid, session]);
  const authoritative =
    validatedGhost?.key === ghostKey ? validatedGhost.result : undefined;
  const ghost =
    ghostTransform === undefined
      ? undefined
      : {
          kind: tool,
          transform: ghostTransform,
          valid: localResult?.valid === true && (authoritative?.valid ?? true),
          pending: localResult?.valid === true && authoritative === undefined,
          reason:
            localResult?.reason ??
            (authoritative?.reason
              ? authoritative.reason.replaceAll('_', ' ').toLowerCase()
              : undefined),
        };
  const hoveredRailEdgeId =
    tool === 'rail-erase' && snapshot !== undefined && hovered !== undefined
      ? railEdgeAt(snapshot, hovered)?.id
      : undefined;
  const hoveredDismantleEntityId =
    tool === 'dismantle' && snapshot !== undefined && hovered !== undefined
      ? (() => {
          const entity = entityAt(snapshot, hovered);
          return entity === undefined || isEntityDismantling(entity)
            ? undefined
            : entity.id;
        })()
      : undefined;
  const selectedEntity =
    snapshot === undefined || selectedEntityId === undefined
      ? undefined
      : snapshot.entities.find((entity) => entity.id === selectedEntityId);
  const selectedPod = snapshot?.pods.find((pod) => pod.id === selectedPodId);
  const factoryOptions = useMemo(() => {
    const query = catalogueQuery.trim().toLowerCase();
    return factories.filter(
      (factory) =>
        query.length === 0 ||
        factory.name.toLowerCase().includes(query) ||
        'factory design blueprint'.includes(query),
    );
  }, [catalogueQuery, factories]);
  useEffect(() => {
    if (!showInspector) return;
    const frame = requestAnimationFrame(() => {
      const panel =
        workspaceRef.current?.querySelector<HTMLElement>('.world-inspector');
      const selector = selectedEntityId
        ? '.world-building-card'
        : selectedPodId
          ? '.world-pod-card'
          : undefined;
      const card = selector
        ? panel?.querySelector<HTMLElement>(selector)
        : undefined;
      if (panel && card)
        panel.scrollTop +=
          card.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          74;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedEntityId, selectedPodId, showInspector]);
  const askConfirmation = useCallback(
    (request: {
      readonly title: string;
      readonly message: string;
      readonly confirmText: string;
      readonly action: () => Promise<void>;
    }) => setConfirmation(request),
    [],
  );
  const dismantleSelection = useCallback(
    async (selection: {
      readonly entityIds: readonly WorldEntity['id'][];
      readonly railEdgeIds: readonly RailEdgeId[];
    }) => {
      setError(undefined);
      setSelected(undefined);
      setSelectedEntityId(undefined);
      setSelectedPodId(undefined);
      setSelectedRailEdgeId(undefined);
      setRailCandidateEdges([]);
      if (
        selection.entityIds.length === 0 &&
        selection.railEdgeIds.length === 0
      )
        return;
      const result = await run((client) =>
        client.command({
          type: 'DISMANTLE_SELECTION',
          entityIds: selection.entityIds,
          railEdgeIds: selection.railEdgeIds,
        }),
      );
      if (result === undefined) {
        setError(
          session.store.getSnapshot().error ??
            'The selected objects could not be dismantled.',
        );
        return;
      }
      if (result.commandFailures !== undefined) {
        const messages = [
          ...new Set(result.commandFailures.map((failure) => failure.message)),
        ];
        setError(
          `Some selected targets could not be dismantled: ${messages.join(' ')}`,
        );
      }
    },
    [run, session],
  );
  const chooseTool = useCallback(
    (next: WorldTool) => {
      if (next === 'drill') {
        const mineId =
          selectedEntity?.kind === 'mine'
            ? selectedEntity.id
            : selectedEntity?.kind === 'drill'
              ? selectedEntity.mineId
              : undefined;
        if (mineId === undefined) {
          setError('Select a mine before choosing Drill.');
          return;
        }
        setBoundMineId(mineId);
      } else setBoundMineId(undefined);
      setTool(next);
      setError(undefined);
    },
    [selectedEntity],
  );
  const selectedRailEdge =
    selectedRailEdgeId === undefined || snapshot === undefined
      ? undefined
      : snapshot.railEdges.find((e) => e.id === selectedRailEdgeId);

  const placementContext = JSON.stringify([
    tool,
    rotation,
    mineResource,
    effectiveBoundMineId,
    activeFactoryId,
    contract?.blueprintHash,
    compileState,
    sessionState.generation,
  ]);
  const placementContextRef = useRef(placementContext);
  const pendingPlacementsRef = useRef(new Set<string>());
  useEffect(() => {
    placementContextRef.current = placementContext;
  }, [placementContext]);
  const placeRail = useCallback(
    async (points: readonly GridPoint[]) => {
      const endpoint = points.at(-1);
      if (endpoint !== undefined) setSelected(endpoint);
      setSelectedEntityId(undefined);
      setSelectedPodId(undefined);
      setSelectedRailEdgeId(undefined);
      setRailCandidateEdges([]);
      setError(undefined);
      const clearance = snapshot && validateRailPath(snapshot.grid, points);
      if (!clearance?.valid) {
        setError(clearance?.reason ?? 'World is not ready');
        return;
      }
      await run((client) =>
        client.command({ type: 'PLACE_RAIL_PATH', points }),
      );
    },
    [run, snapshot],
  );

  const handleMapClick = useCallback(
    async (point: GridPoint) => {
      if (tool === 'rail' || tool === 'dismantle') return;
      const context = placementContextRef.current;
      const key = `${context}:${point.x}:${point.y}`;
      if (pendingPlacementsRef.current.has(key)) return;
      pendingPlacementsRef.current.add(key);
      try {
        setSelected(point);
        if (tool === 'select') {
          if (snapshot !== undefined)
            setSelectedEntityId(entityAt(snapshot, point)?.id);
          return;
        }
        setSelectedEntityId(undefined);
        setSelectedPodId(undefined);
        setSelectedRailEdgeId(undefined);
        if (tool === 'rail-erase') {
          const edges =
            snapshot === undefined ? [] : railEdgesAt(snapshot, point);
          if (edges.length === 0) {
            setError('No rail segment on this tile.');
            return;
          }
          if (edges.length > 1) {
            setRailCandidateEdges(edges.map((edge) => edge.id));
            setSelectedRailEdgeId(edges[0]!.id);
            setShowInspector(true);
            setError(
              'Several rail edges overlap here. Choose the direction in the inspector.',
            );
            return;
          }
          const edge = edges[0]!;
          setRailCandidateEdges([edge.id]);
          await run((client) =>
            client.command({ type: 'REMOVE_RAIL_EDGE', edgeId: edge.id }),
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
          const mineId = effectiveBoundMineId;
          if (mineId === undefined) {
            setError('Select a mine before placing its drill chain.');
            return;
          }
          await run((client) =>
            client.command({ type: 'PLACE_DRILL', mineId, position: point }),
          );
          return;
        }
        const transform = transformFor(tool, point);
        if (transform === undefined) return;
        const station = stationFor(transform);
        if (station === undefined && tool !== 'depot') {
          setError('Place one free adjacent station first.');
          return;
        }
        if (tool === 'mine') {
          const local = localValidation(transform, tool);
          if (!local.valid) {
            setError(local.reason ?? 'Invalid mine placement.');
            return;
          }
        }
        if (tool === 'factory' && (compileState !== 'ready' || !contract)) {
          setError('The current factory draft needs a valid compilation.');
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
              ...(tool !== 'depot' && station
                ? { stationId: station.stationId }
                : {}),
              ...(targetKind === 'mine' ? { resourceId: mineResource } : {}),
            }),
          false,
        );
        if (
          validation?.validation?.valid !== true ||
          validation.validationRevision !==
            session.store.getSnapshot().snapshot?.revision
        ) {
          setError(
            validation?.validation?.valid === true
              ? 'World changed while validating. Place again to refresh the preview.'
              : `Invalid placement: ${validation?.validation?.reason ?? 'worker rejected placement'}`,
          );
          return;
        }
        if (placementContextRef.current !== context) {
          setError(
            'Placement cancelled because the building or factory design changed.',
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
            ...(tool !== 'depot' && station
              ? { stationId: station.stationId }
              : {}),
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
      } finally {
        pendingPlacementsRef.current.delete(key);
      }
    },
    [
      activeFactoryId,
      compileState,
      session,
      contract,
      mineResource,
      run,
      effectiveBoundMineId,
      snapshot,
      stationFor,
      localValidation,
      tool,
      transformFor,
    ],
  );
  const regenerate = async () => {
    if (snapshot !== undefined) {
      askConfirmation({
        title: 'Generate a new world?',
        message:
          'The current world is replaced only after generation succeeds. Its last successful save remains available if generation fails.',
        confirmText: 'Generate world',
        action: async () => {
          await regenerateNow();
        },
      });
      return;
    }
    await regenerateNow();
  };
  const regenerateNow = async () => {
    const result = await session.replace(
      defaultWorldGenerationConfig(seed.trim() || 'starter-world'),
    );
    if (result !== undefined) {
      setSelected(undefined);
      setSelectedEntityId(undefined);
      setSelectedPodId(undefined);
    }
  };
  const reloadLastSavedWorld = async () => {
    await session.replace();
    setError(undefined);
    setSelected(undefined);
    setSelectedEntityId(undefined);
    setSelectedPodId(undefined);
    setTool('select');
  };
  const openConfirmation = async () => {
    const request = confirmation;
    if (request === undefined) return;
    setConfirmation(undefined);
    await request.action();
    workspaceRef.current?.focus();
  };
  const focusEntities = (ids: readonly string[]): void => {
    const entity = snapshot?.entities.find((item) => ids.includes(item.id));
    if (entity !== undefined) {
      setSelectedEntityId(entity.id);
      setSelectedPodId(undefined);
      setSelected(entity.transform.position);
      setCameraFocus(entity.transform.position);
    }
    const pod = snapshot?.pods.find((item) => ids.includes(item.id));
    if (pod !== undefined) {
      setSelectedPodId(pod.id);
      setSelectedEntityId(undefined);
      const node = snapshot?.railNodes.find((item) => item.id === pod.nodeId);
      if (node !== undefined) {
        setSelected(node.position);
        setCameraFocus(node.position);
      }
    }
  };
  const onWorldKeyDown = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (
        hidden ||
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="alertdialog"]',
        )
      )
        return;

      const factoryIndex = Number(event.key) - 1;
      const numberedFactory =
        event.key.length === 1 && factoryIndex >= 0 && factoryIndex < 9
          ? factoryOptions[factoryIndex]
          : undefined;
      if (numberedFactory !== undefined) {
        event.preventDefault();
        onSelectFactory(numberedFactory.id);
        chooseTool('factory');
        return;
      }

      const found = tools.find(
        (item) => item.key.toLowerCase() === event.key.toLowerCase(),
      );
      if (found !== undefined) {
        event.preventDefault();
        chooseTool(found.id);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmation(undefined);
        chooseTool('select');
        return;
      }
      if (
        event.key.toLowerCase() === 'r' &&
        ['factory', 'mine', 'storage', 'depot'].includes(tool)
      ) {
        event.preventDefault();
        setRotation(
          (value) => ((value + (event.shiftKey ? 3 : 1)) % 4) as QuarterTurn,
        );
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (selectedRailEdgeId !== undefined) {
          const edgeId = selectedRailEdgeId;
          askConfirmation({
            title: 'Remove rail segment?',
            message:
              'Pods using this edge may reject removal until their active route is clear.',
            confirmText: 'Remove rail',
            action: async () => {
              await run((client) =>
                client.command({ type: 'REMOVE_RAIL_EDGE', edgeId }),
              );
            },
          });
        } else if (selectedEntity !== undefined) {
          const entity = selectedEntity;
          if (entity.kind === 'construction-site')
            askConfirmation({
              title: 'Cancel construction?',
              message:
                'Delivered materials will be evacuated through the station.',
              confirmText: 'Cancel construction',
              action: async () => {
                await run((client) =>
                  client.command({
                    type: 'CANCEL_CONSTRUCTION',
                    siteId: entity.id,
                  }),
                );
              },
            });
          else if (
            [
              'factory',
              'mine',
              'storage',
              'depot',
              'station',
              'drill',
            ].includes(entity.kind)
          )
            askConfirmation({
              title:
                entity.kind === 'station'
                  ? 'Remove station?'
                  : entity.kind === 'drill'
                    ? 'Dismantle drill?'
                    : 'Dismantle building?',
              message:
                entity.kind === 'station'
                  ? 'The station must be unlinked and clear of logistics traffic. ' +
                    'Connected rail stays as a plain endpoint.'
                  : entity.kind === 'drill'
                    ? 'Recovered materials return by rail from the mine station.'
                    : 'Its contents will be recovered through rail salvage.',
              confirmText:
                entity.kind === 'station' ? 'Remove station' : 'Dismantle',
              action: async () => {
                await run((client) =>
                  client.command({
                    type: 'DISMANTLE_ENTITY',
                    entityId: entity.id,
                  }),
                );
              },
            });
        }
      }
    },
    [
      hidden,
      factoryOptions,
      onSelectFactory,
      chooseTool,
      tool,
      selectedRailEdgeId,
      selectedEntity,
      askConfirmation,
      run,
    ],
  );
  useEffect(() => {
    window.addEventListener('keydown', onWorldKeyDown);
    return () => window.removeEventListener('keydown', onWorldKeyDown);
  }, [onWorldKeyDown]);
  const setTime = async (
    paused: boolean,
    timeScale = snapshot?.timeScale ?? 1,
  ) => {
    await session.setTime(paused, timeScale);
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
  const query = catalogueQuery.trim().toLowerCase();
  const matchesQuery = (item: (typeof tools)[number]) =>
    `${item.label} ${item.id}`.toLowerCase().includes(query);
  const catalogueBuildings = tools.filter(
    (item) =>
      ['mine', 'drill', 'station', 'storage', 'depot'].includes(item.id) &&
      matchesQuery(item),
  );
  const catalogueActions = tools.filter(
    (item) =>
      ['select', 'rail', 'rail-erase', 'junction', 'dismantle'].includes(
        item.id,
      ) && matchesQuery(item),
  );
  const activeToolLabel =
    tool === 'factory'
      ? factoryName
      : (tools.find((item) => item.id === tool)?.label ?? 'Select');
  const toolFootprint = (id: WorldTool) => {
    if (id === 'factory') return contract?.footprint;
    if (id === 'station') return worldContent.stationFootprint;
    if (id === 'drill') return worldContent.drill.footprint;
    if (id === 'junction') return undefined;
    return worldContent.buildings.find((building) => building.kind === id)
      ?.footprint;
  };
  const toolCost = (id: WorldTool) => {
    if (id === 'factory') return contract?.billOfMaterials ?? [];
    if (id === 'drill') return worldContent.drill.buildCost;
    return (
      worldContent.buildings.find((building) => building.kind === id)
        ?.buildCost ?? []
    );
  };
  const toolRequirement = (id: WorldTool) =>
    ['factory', 'mine', 'storage'].includes(id)
      ? 'Requires an adjacent free station'
      : id === 'depot'
        ? 'Autonomous depot; connect its rail hookup for construction deliveries'
        : id === 'drill'
          ? `Bound mine: ${effectiveBoundMineId ?? 'select a mine first'}`
          : id === 'rail'
            ? 'Connect endpoints in one straight or orthogonal path'
            : id === 'junction'
              ? 'Places a control node; it does not occupy a tile'
              : id === 'station'
                ? '2 × 2 station anchor'
                : id === 'select'
                  ? 'Click a building to inspect it'
                  : id === 'rail-erase'
                    ? 'Click a segment to remove it'
                    : id === 'dismantle'
                      ? 'Drag over objects and rail cells · release to dismantle · Esc to cancel'
                      : '';
  return (
    <div
      ref={workspaceRef}
      tabIndex={0}
      className={`world-workspace world-workspace--map${hidden ? ' is-hidden' : ''}${showInspector ? ' has-inspector' : ''}${showCatalogue ? ' has-catalogue' : ''}`}
      aria-hidden={hidden}
    >
      <aside className={`world-sites panel${showCatalogue ? ' is-open' : ''}`}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Construction</span>
            <h2>Buildings</h2>
          </div>
          <button
            aria-label="Close building list"
            onClick={() => setShowCatalogue(false)}
          >
            ×
          </button>
        </div>
        <label className="world-catalogue-search">
          <span>Find a building or action</span>
          <input
            value={catalogueQuery}
            onChange={(event) => setCatalogueQuery(event.target.value)}
            placeholder="Search by name"
          />
        </label>
        <section className="world-palette-section">
          <h3>Factory designs</h3>
          <div
            className="world-tool-grid"
            role="group"
            aria-label="Factory designs"
          >
            {factoryOptions.map((factory, index) => {
              const isCurrentDesign = factory.id === activeFactoryId;
              const footprint = isCurrentDesign
                ? contract?.footprint
                : undefined;
              const cost =
                isCurrentDesign && contract?.billOfMaterials !== undefined
                  ? contract.billOfMaterials.reduce(
                      (sum, item) => sum + item.quantity,
                      0,
                    )
                  : undefined;
              return (
                <button
                  key={factory.id}
                  className={`world-building-option${tool === 'factory' && isCurrentDesign ? ' is-active' : ''}`}
                  aria-label={`Build ${factory.name}`}
                  aria-pressed={tool === 'factory' && isCurrentDesign}
                  onClick={() => {
                    onSelectFactory(factory.id);
                    chooseTool('factory');
                  }}
                >
                  <WorldThumbnail kind="factory" />
                  <span className="world-building-option-copy">
                    <strong>{factory.name}</strong>
                    <small>
                      {footprint === undefined
                        ? isCurrentDesign
                          ? compileState === 'invalid'
                            ? 'Fix this design before building'
                            : 'Preparing design…'
                          : 'Factory blueprint'
                        : `${footprint.width} × ${footprint.height} tiles${cost === undefined ? '' : ` · ${cost} materials`}`}
                    </small>
                  </span>
                  {index < 9 && <kbd>{index + 1}</kbd>}
                </button>
              );
            })}
            {factoryOptions.length === 0 && (
              <p className="world-palette-empty">
                {factories.length === 0
                  ? 'No factory designs yet.'
                  : 'No factory designs match this search.'}
              </p>
            )}
          </div>
          {factoryOptions.length > 0 && (
            <p className="world-shortcut-hint">
              Press 1–9 to choose a design. Press <kbd>F</kbd> to enter
              placement mode with the selected one.
            </p>
          )}
        </section>
        {catalogueBuildings.length > 0 && (
          <section className="world-palette-section">
            <h3>Buildings</h3>
            <div
              className="world-tool-grid"
              role="group"
              aria-label="Buildings"
            >
              {catalogueBuildings.map((item) => {
                const footprint = toolFootprint(item.id);
                const totalCost = toolCost(item.id).reduce(
                  (sum, cost) => sum + cost.quantity,
                  0,
                );
                return (
                  <button
                    key={item.id}
                    className={`world-building-option${tool === item.id ? ' is-active' : ''}`}
                    aria-pressed={tool === item.id}
                    onClick={() => chooseTool(item.id)}
                  >
                    <WorldThumbnail kind={item.id} />
                    <span className="world-building-option-copy">
                      <strong>{item.label}</strong>
                      <small>
                        {footprint === undefined
                          ? toolRequirement(item.id)
                          : `${footprint.width} × ${footprint.height} tiles${totalCost === 0 ? '' : ` · ${totalCost} materials`}`}
                      </small>
                    </span>
                    <kbd>{item.key}</kbd>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {catalogueActions.length > 0 && (
          <section className="world-palette-section">
            <h3>Rail &amp; actions</h3>
            <div
              className="world-tool-grid"
              role="group"
              aria-label="Rail and actions"
            >
              {catalogueActions.map((item) => (
                <button
                  key={item.id}
                  className={`world-building-option${tool === item.id ? ' is-active' : ''}`}
                  aria-pressed={tool === item.id}
                  onClick={() => chooseTool(item.id)}
                >
                  <WorldThumbnail kind={item.id} />
                  <span className="world-building-option-copy">
                    <strong>{item.label}</strong>
                    <small>{toolRequirement(item.id)}</small>
                  </span>
                  <kbd>{item.key}</kbd>
                </button>
              ))}
            </div>
          </section>
        )}
        {tool === 'mine' && (
          <label className="world-tool-options">
            <span>Ore to extract</span>
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
          </label>
        )}
        {tool === 'rail' && (
          <p className="world-palette-hint">
            Drag across the map and release to place one straight line. Diagonal
            drags follow the longer grid axis.
          </p>
        )}
        {['factory', 'mine', 'storage', 'depot'].includes(tool) && (
          <p className="world-palette-hint">
            Rotate with <kbd>R</kbd>; use <kbd>Shift</kbd> + <kbd>R</kbd> to
            rotate back.
          </p>
        )}
      </aside>
      <section
        className="world-map world-map--three"
        aria-label="World overview"
      >
        {snapshot === undefined ? (
          <div className="world-loading">
            {error ?? 'Generating deterministic world…'}
          </div>
        ) : rendererReleased && hidden ? (
          <div className="world-loading">World renderer is inactive.</div>
        ) : (
          <Suspense
            fallback={
              <div className="world-loading">Loading WebGL renderer…</div>
            }
          >
            <WorldCanvas
              key={`${snapshot.worldId}:${sessionState.generation}`}
              getSnapshot={getSnapshot}
              settingsOpen={showSettings}
              interactionBlocked={confirmation !== undefined}
              activeTool={tool}
              onPlaceRail={(points) => void placeRail(points)}
              onDismantleSelection={(selection) =>
                void dismantleSelection(selection)
              }
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                if (id) {
                  setShowInspector(true);
                  setShowCatalogue(false);
                }
              }}
              onSelectRailEdge={(id) => {
                setSelectedRailEdgeId(id);
                if (id) {
                  setShowInspector(true);
                  setShowCatalogue(false);
                }
                setRailCandidateEdges(id === undefined ? [] : [id]);
              }}
              onSelectPod={(id) => {
                setSelectedPodId(id);
                if (id) {
                  setShowInspector(true);
                  setShowCatalogue(false);
                }
              }}
              {...(selectedEntityId === undefined ? {} : { selectedEntityId })}
              {...(selected === undefined ? {} : { selected })}
              {...(cameraFocus === undefined ? {} : { cameraFocus })}
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
              onSelect={(point) => void handleMapClick(point)}
              onHover={setHovered}
            />
          </Suspense>
        )}
        <div className="world-map-caption">
          <span>{activeToolLabel}</span>
          <small>
            {tool === 'rail'
              ? 'Drag to draw · release to place'
              : tool === 'dismantle'
                ? 'Drag over objects and rail cells · release to dismantle · Esc to cancel'
                : 'Right-drag to orbit · wheel to zoom'}
          </small>
        </div>
        <div
          className="world-session-bar"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="world-session-title">
            <span className="world-session-mark">F</span>
            <span>
              <strong>World</strong>
              <small>
                {snapshot === undefined
                  ? 'Loading'
                  : `${snapshot.grid.width} × ${snapshot.grid.height}`}
              </small>
            </span>
            <span className={`world-save-state is-${saveState}`} role="status">
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'error'
                  ? 'Save failed'
                  : saveState === 'dirty'
                    ? 'Unsaved changes'
                    : 'Saved'}
            </span>
          </div>
          <div className="world-time-controls">
            <button
              aria-label={snapshot?.paused ? 'Play world' : 'Pause world'}
              onClick={() => void setTime(snapshot?.paused === false)}
            >
              {snapshot?.paused === false ? 'Pause' : 'Play'}
            </button>
            {([1, 5, 20] as const).map((speed) => (
              <button
                key={speed}
                aria-pressed={snapshot?.timeScale === speed}
                onClick={() => void setTime(snapshot?.paused ?? true, speed)}
              >
                {speed}×
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const next = !showCatalogue;
              setShowCatalogue(next);
              if (next) setShowInspector(false);
            }}
            aria-expanded={showCatalogue}
          >
            Buildings
          </button>
          <button
            onClick={() => {
              const next = !showInspector;
              setShowInspector(next);
              if (next) setShowCatalogue(false);
            }}
            aria-expanded={showInspector}
          >
            Inspector
          </button>
          {selectedEntity !== undefined &&
            isEntityDismantling(selectedEntity) && (
              <div className="world-permanent-destroy-action">
                <button
                  className="button button--danger"
                  onClick={() =>
                    askConfirmation({
                      title: 'Détruire définitivement ce bâtiment ?',
                      message:
                        'Le bâtiment, les ressources encore en récupération et les cargaisons liées seront détruits définitivement.',
                      confirmText: 'Détruire définitivement',
                      action: async () => {
                        await run((client) =>
                          client.command({
                            type: 'DESTROY_DISMANTLED_ENTITY',
                            entityId: selectedEntity.id,
                          }),
                        );
                      },
                    })
                  }
                >
                  Détruire définitivement
                </button>
              </div>
            )}
          <button
            aria-label={saveState === 'error' ? 'Retry save' : 'Save world now'}
            onClick={() => void run((client) => client.save(true))}
          >
            {saveState === 'error' ? 'Retry save' : 'Save'}
          </button>
          <button
            aria-label="World settings"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((value) => !value)}
          >
            ⚙
          </button>
        </div>
        {showSettings && (
          <div
            className="world-generation-settings"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <strong>World settings</strong>
            <label className="world-seed">
              <span>Generation seed</span>
              <input
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
              />
            </label>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void regenerate()}
            >
              Generate new world
            </button>
            <span>
              Graphics quality, overlays, minimap, and motion are saved on this
              device.
            </span>
          </div>
        )}
        {error !== undefined && (
          <div className="world-alerts" role="status">
            <strong>World needs attention</strong>
            <p>{error}</p>
            {workerFailed ? (
              <button
                disabled={busy}
                onClick={() =>
                  askConfirmation({
                    title: 'Reload last saved world?',
                    message:
                      'Unsaved changes since the last successful save will be lost. The saved world will be loaded into a new worker.',
                    confirmText: 'Reload saved world',
                    action: reloadLastSavedWorld,
                  })
                }
              >
                Reload last saved world
              </button>
            ) : (
              <button
                onClick={() => void run((client) => client.snapshot(), false)}
              >
                Reconcile world
              </button>
            )}
          </div>
        )}
        {snapshot?.diagnostics.map((diagnostic) => (
          <button
            key={`${diagnostic.code}-${diagnostic.entityIds.join('-')}`}
            className="world-alert-chip"
            onClick={() => focusEntities(diagnostic.entityIds)}
          >
            <b>{diagnostic.code.replaceAll('_', ' ')}</b>
            <span>{diagnostic.message}</span>
          </button>
        ))}
        {ghost !== undefined && (
          <div
            className={`world-placement-feedback ${ghost.pending ? 'is-pending' : ghost.valid ? 'is-valid' : 'is-invalid'}`}
            role="status"
          >
            <strong>
              {ghost.pending
                ? 'Checking placement…'
                : ghost.valid
                  ? 'Ready to build'
                  : 'Can’t build here'}
            </strong>
            <span>{ghost.reason ?? toolRequirement(tool)}</span>
            <small>
              {toolCost(tool)
                .map(
                  (cost) =>
                    `${cost.quantity} ${resourceById.get(cost.resourceId)?.name ?? cost.resourceId}`,
                )
                .join(' · ') || 'No construction materials'}
              {['factory', 'mine', 'storage', 'depot'].includes(tool)
                ? ` · ${rotation * 90}°`
                : ''}
            </small>
          </div>
        )}
      </section>
      <nav className="world-build-dock" aria-label="Quick actions">
        <button
          aria-pressed={tool === 'select'}
          onClick={() => chooseTool('select')}
        >
          Select <kbd>S</kbd>
        </button>
        <button
          aria-pressed={tool === 'rail'}
          onClick={() => chooseTool('rail')}
        >
          Rail <kbd>T</kbd>
        </button>
        <button
          aria-pressed={tool === 'dismantle'}
          onClick={() => chooseTool('dismantle')}
        >
          Dismantle <kbd>C</kbd>
        </button>
      </nav>
      <aside
        className={`world-inspector panel${showInspector ? ' is-open' : ''}`}
      >
        {showInspector && !hidden && (
          <>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">World</span>
                <h2>Inspector</h2>
              </div>
              <button
                aria-label="Close inspector"
                onClick={() => setShowInspector(false)}
              >
                ×
              </button>
            </div>
            {error !== undefined && (
              <p className="world-error" role="alert">
                {error}
              </p>
            )}
            {selected !== undefined && selectedDescription !== undefined && (
              <section className="inspector-card">
                <h3>Tile</h3>
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
            {selectedPod !== undefined && snapshot !== undefined && (
              <section className="inspector-card world-pod-card">
                <h3>Cargo pod</h3>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {selectedPod.state.toLowerCase().replaceAll('_', ' ')}
                    </dd>
                  </div>
                  <div>
                    <dt>Cargo</dt>
                    <dd>
                      {selectedPod.cargo === undefined
                        ? 'Empty'
                        : `${resourceById.get(selectedPod.cargo.resourceId)?.name ?? selectedPod.cargo.resourceId} · ${selectedPod.cargo.quantity}`}
                    </dd>
                  </div>
                  {selectedPod.missionId !== undefined && (
                    <div>
                      <dt>Delivery</dt>
                      <dd>
                        {snapshot.missions.find(
                          (mission) => mission.id === selectedPod.missionId,
                        )?.quantity ?? 'In transit'}{' '}
                        units
                      </dd>
                    </div>
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
                </dl>
                {railCandidateEdges.length > 1 && (
                  <div
                    className="world-rail-candidates"
                    aria-label="Overlapping rail choices"
                  >
                    <strong>Choose rail direction</strong>
                    {railCandidateEdges.map((edgeId, index) => {
                      const edge = snapshot?.railEdges.find(
                        (candidate) => candidate.id === edgeId,
                      );
                      if (edge === undefined) return null;
                      const from = snapshot?.railNodes.find(
                        (node) => node.id === edge.from,
                      )?.position;
                      const to = snapshot?.railNodes.find(
                        (node) => node.id === edge.to,
                      )?.position;
                      return (
                        <button
                          key={edgeId}
                          aria-pressed={selectedRailEdgeId === edgeId}
                          onClick={() => setSelectedRailEdgeId(edgeId)}
                        >
                          Path {index + 1}: {from?.x}, {from?.y} → {to?.x},{' '}
                          {to?.y}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  className="danger-button"
                  onClick={() =>
                    askConfirmation({
                      title: 'Remove rail segment?',
                      message:
                        'Pods using this edge may reject removal until their active route is clear.',
                      confirmText: 'Remove rail',
                      action: async () => {
                        await run((client) =>
                          client.command({
                            type: 'REMOVE_RAIL_EDGE',
                            edgeId: selectedRailEdge.id,
                          }),
                        );
                      },
                    })
                  }
                >
                  Remove rail
                </button>
              </section>
            )}
            {selectedEntity !== undefined && snapshot !== undefined && (
              <section className="inspector-card world-building-card">
                <h3>
                  Selected{' '}
                  {selectedEntity.kind === 'factory'
                    ? (factories.find(
                        (factory) => factory.id === selectedEntity.factoryId,
                      )?.name ?? 'factory')
                    : selectedEntity.kind.replaceAll('-', ' ')}
                </h3>
                <WorldBuildingInspector
                  entity={selectedEntity}
                  getSnapshot={getSnapshot}
                  onRemoveRule={(resourceId) =>
                    void run((client) =>
                      client.command({
                        type: 'REMOVE_STATION_RULE',
                        entityId: selectedEntity.id,
                        resourceId,
                      }),
                    )
                  }
                  {...(selectedEntity.kind === 'factory'
                    ? {
                        displayName:
                          factories.find(
                            (factory) =>
                              factory.id === selectedEntity.factoryId,
                          )?.name ?? 'Factory',
                      }
                    : {})}
                  busy={busy}
                  onQueuePod={() => {
                    if (selectedEntity.kind !== 'depot') return;
                    void run((client) =>
                      client.command({
                        type: 'QUEUE_POD_PRODUCTION',
                        depotId: selectedEntity.id,
                      }),
                    );
                  }}
                  onCancelPod={() => {
                    if (selectedEntity.kind !== 'depot') return;
                    void run((client) =>
                      client.command({
                        type: 'CANCEL_POD_PRODUCTION',
                        depotId: selectedEntity.id,
                      }),
                    );
                  }}
                />
                {selectedEntity.kind === 'factory' && (
                  <button
                    className="button button--block"
                    aria-label={
                      'Open placed ' +
                      (factories.find(
                        (factory) => factory.id === selectedEntity.factoryId,
                      )?.name ?? 'factory') +
                      ' blueprint'
                    }
                    onClick={() => onOpenFactory(selectedEntity.factoryId)}
                  >
                    Open placed factory blueprint
                  </button>
                )}
                {isEntityDismantling(selectedEntity) ? (
                  <>
                    <button
                      className="button button--block"
                      title="Return this building to construction and recover its remaining materials."
                      onClick={() =>
                        void run((client) =>
                          client.command({
                            type: 'CANCEL_DISMANTLE',
                            entityId: selectedEntity.id,
                          }),
                        )
                      }
                    >
                      Cancel dismantling
                    </button>
                    <p className="world-empty-state">
                      This building returns to construction; materials already
                      recovered are reused.
                    </p>
                  </>
                ) : (
                  (selectedEntity.kind === 'factory' ||
                    selectedEntity.kind === 'mine' ||
                    selectedEntity.kind === 'storage' ||
                    selectedEntity.kind === 'depot' ||
                    selectedEntity.kind === 'station' ||
                    selectedEntity.kind === 'drill') && (
                    <button
                      className="danger-button"
                      onClick={() => {
                        askConfirmation({
                          title:
                            selectedEntity.kind === 'station'
                              ? 'Remove station?'
                              : selectedEntity.kind === 'drill'
                                ? 'Dismantle drill?'
                                : 'Dismantle building?',
                          message:
                            selectedEntity.kind === 'station'
                              ? 'The station must be unlinked and clear of logistics traffic. ' +
                                'Connected rail stays as a plain endpoint.'
                              : selectedEntity.kind === 'drill'
                                ? 'Recovered materials return by rail from the mine station.'
                                : `Dismantling this ${selectedEntity.kind} routes its contents to salvage by rail.`,
                          confirmText:
                            selectedEntity.kind === 'station'
                              ? 'Remove station'
                              : 'Dismantle',
                          action: async () => {
                            await run((client) =>
                              client.command({
                                type: 'DISMANTLE_ENTITY',
                                entityId: selectedEntity.id,
                              }),
                            );
                          },
                        });
                      }}
                    >
                      {selectedEntity.kind === 'station'
                        ? 'Remove station'
                        : 'Dismantle'}
                    </button>
                  )
                )}
                {selectedEntity.kind === 'construction-site' && (
                  <button
                    className="danger-button"
                    onClick={() =>
                      askConfirmation({
                        title: 'Cancel construction?',
                        message:
                          'Delivered materials will be evacuated through the site station. The site remains until evacuation finishes.',
                        confirmText: 'Cancel construction',
                        action: async () => {
                          await run((client) =>
                            client.command({
                              type: 'CANCEL_CONSTRUCTION',
                              siteId: selectedEntity.id,
                            }),
                          );
                        },
                      })
                    }
                  >
                    Cancel and evacuate
                  </button>
                )}
                {selectedEntity.kind === 'factory' &&
                  selectedEntity.state !== 'DISMANTLING' &&
                  contract !== undefined &&
                  compileState === 'ready' && (
                    <button
                      className="button button--primary button--block"
                      onClick={() =>
                        askConfirmation({
                          title: 'Replace placed factory?',
                          message: `The new footprint will be ${contract.footprint.width} × ${contract.footprint.height} tiles at the same position, orientation and station. Existing contents will be routed to salvage; the new factory will be rebuilt with ${contract.billOfMaterials?.reduce((sum, item) => sum + item.quantity, 0) ?? 0} construction items.`,
                          confirmText: 'Replace factory',
                          action: async () => {
                            await run((client) =>
                              client.command({
                                type: 'REPLACE_FACTORY',
                                entityId: selectedEntity.id,
                                position: selectedEntity.transform.position,
                                size: gridSize(
                                  contract.footprint.width,
                                  contract.footprint.height,
                                ),
                                rotation: selectedEntity.transform.rotation,
                                cost: contract.billOfMaterials ?? [],
                                factoryId: activeFactoryId,
                                instanceId: asId<InstanceId>(
                                  `instance-${Date.now()}`,
                                ),
                                contract: serializeContract(contract),
                              }),
                            );
                          },
                        })
                      }
                    >
                      Replace with {factoryName}
                    </button>
                  )}
                {selectedEntity.kind === 'storage' && (
                  <StockRules
                    busy={busy}
                    stations={snapshot.stations.filter(
                      (station) =>
                        station.id.startsWith(`rule:${selectedEntity.id}:`) &&
                        station.role === 'storage',
                    )}
                    onChange={(resourceId, minimum, maximum) =>
                      void run((client) =>
                        client.command({
                          type: 'CONFIGURE_STATION',
                          entityId: selectedEntity.id,
                          resourceId,
                          mode: 'stock',
                          target: minimum,
                          maximum,
                          priority: 0,
                        }),
                      )
                    }
                  />
                )}
              </section>
            )}
            {selected === undefined &&
              selectedEntity === undefined &&
              selectedPod === undefined &&
              selectedRailEdge === undefined && (
                <p className="world-inspector-empty">
                  Select a building, rail segment or tile to see its details.
                </p>
              )}
            {tool === 'factory' && (
              <section className="inspector-card world-contract">
                <h3>Design · {factoryName}</h3>
                <p>
                  {contract === undefined
                    ? compileState === 'invalid'
                      ? 'Fix the factory design before building it.'
                      : 'Preparing factory design…'
                    : `${contract.footprint.width} × ${contract.footprint.height} tiles · ${contract.billOfMaterials?.reduce((sum, item) => sum + item.quantity, 0) ?? 0} materials.`}
                </p>
                {contractRows.map((row) => (
                  <div
                    className="world-contract-row"
                    key={`${row.role}-${row.resourceId}`}
                  >
                    <span>{row.role === 'input' ? 'Input' : 'Output'}</span>
                    <strong>
                      {resourceById.get(row.resourceId)?.name ?? row.resourceId}
                    </strong>
                    <b>{formatRate(row.rate)}/s</b>
                    <small>Capacity {formatRate(row.maximum)}/s</small>
                  </div>
                ))}
                <button
                  aria-label={`Open ${factoryName} factory`}
                  className="button button--block"
                  onClick={() => onOpenFactory(activeFactoryId)}
                >
                  Edit this design
                </button>
              </section>
            )}
            <details
              className="world-object-browser"
              open={showObjectBrowser}
              onToggle={(event) =>
                setShowObjectBrowser(event.currentTarget.open)
              }
            >
              <summary>Browse all world objects</summary>
              {showObjectBrowser && (
                <>
                  <section className="inspector-card">
                    <h3>Buildings &amp; sites</h3>
                    <ul className="world-entity-list">
                      {snapshot?.entities.map((entity) => (
                        <li key={entity.id}>
                          <button
                            aria-pressed={selectedEntityId === entity.id}
                            onClick={() => {
                              setSelected(entity.transform.position);
                              setSelectedEntityId(entity.id);
                              setSelectedPodId(undefined);
                              setCameraFocus(entity.transform.position);
                            }}
                          >
                            {entity.kind === 'factory'
                              ? (factories.find(
                                  (factory) => factory.id === entity.factoryId,
                                )?.name ?? 'Factory')
                              : entity.kind.replaceAll('-', ' ')}{' '}
                            · {entity.transform.position.x},{' '}
                            {entity.transform.position.y}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="inspector-card">
                    <h3>Cargo pods</h3>
                    {snapshot?.pods.length === 0 ? (
                      <p>No cargo pods.</p>
                    ) : (
                      <ul className="world-entity-list">
                        {snapshot?.pods.map((pod) => {
                          const node = snapshot.railNodes.find(
                            (item) => item.id === pod.nodeId,
                          );
                          return (
                            <li key={pod.id}>
                              <button
                                aria-pressed={selectedPodId === pod.id}
                                onClick={() => {
                                  setSelectedPodId(pod.id);
                                  setSelectedEntityId(undefined);
                                  if (node !== undefined) {
                                    setSelected(node.position);
                                    setCameraFocus(node.position);
                                  }
                                }}
                              >
                                Pod ·{' '}
                                {pod.state.toLowerCase().replaceAll('_', ' ')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                  <section className="inspector-card">
                    <h3>Rail segments</h3>
                    <ul className="world-entity-list">
                      {snapshot?.railEdges.map((edge, index) => (
                        <li key={edge.id}>
                          <button
                            aria-pressed={selectedRailEdgeId === edge.id}
                            onClick={() => {
                              setSelectedRailEdgeId(edge.id);
                              setSelectedEntityId(undefined);
                              setSelectedPodId(undefined);
                              setCameraFocus(edge.points[0]);
                            }}
                          >
                            Segment {index + 1} · {edge.length} tiles
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="inspector-card">
                    <h3>Logistics alerts</h3>
                    {snapshot?.diagnostics.length === 0 ? (
                      <p>No current logistics alerts.</p>
                    ) : (
                      <ul className="world-entity-list">
                        {snapshot?.diagnostics.map((diagnostic) => (
                          <li
                            key={`${diagnostic.code}-${diagnostic.entityIds.join('-')}`}
                          >
                            <button
                              onClick={() =>
                                focusEntities(diagnostic.entityIds)
                              }
                            >
                              {diagnostic.message}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
            </details>
          </>
        )}
      </aside>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {error ??
          (saveState === 'error'
            ? 'World save failed. Use Retry save to try again.'
            : '')}
      </div>
      {confirmation !== undefined && (
        <div className="world-confirm-backdrop">
          <section
            className="world-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="world-confirm-title"
            aria-describedby="world-confirm-message"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setConfirmation(undefined);
                workspaceRef.current?.focus();
              } else if (event.key === 'Tab') {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  ),
                ];
                const first = buttons[0];
                const last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <span className="eyebrow">Confirm action</span>
            <h2 id="world-confirm-title">{confirmation.title}</h2>
            <p id="world-confirm-message">{confirmation.message}</p>
            <div className="world-confirm-actions">
              <button
                autoFocus
                onClick={() => {
                  setConfirmation(undefined);
                  workspaceRef.current?.focus();
                }}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void openConfirmation()}
              >
                {confirmation.confirmText}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
