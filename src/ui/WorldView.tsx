import {
  lazy,
  Suspense,
  type KeyboardEvent,
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
  resources,
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
  const { snapshot, workerFailed, saveState, busy } = sessionState;
  const run = session.run;
  const [seed, setSeed] = useState('starter-world');
  const [selected, setSelected] = useState<GridPoint>();
  const [selectedEntityId, setSelectedEntityId] = useState<WorldEntity['id']>();
  const [selectedPodId, setSelectedPodId] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
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
  const [railDraft, setRailDraft] = useState<readonly GridPoint[]>([]);
  const [railSubmitting, setRailSubmitting] = useState(false);
  const railSubmissionRef = useRef(false);
  const [mineResource, setMineResource] = useState<ResourceId>(asId('ironOre'));
  const [ruleResource, setRuleResource] = useState<ResourceId>(
    asId('ironPlate'),
  );
  const [ruleMode, setRuleMode] = useState<'request' | 'provide'>('request');
  const [ruleTarget, setRuleTarget] = useState(50);
  const [rulePriority, setRulePriority] = useState(0);
  const [interactionError, setError] = useState<string>();
  const error = interactionError ?? sessionState.error;
  const [selectedRailEdgeId, setSelectedRailEdgeId] = useState<RailEdgeId>();
  const [railCandidateEdges, setRailCandidateEdges] = useState<
    readonly RailEdgeId[]
  >([]);
  const [cameraFocus, setCameraFocus] = useState<GridPoint>();
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
        ['factory', 'mine', 'storage', 'depot'].includes(activeTool) &&
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
          reason: 'Place the mine head outside the ore patch.',
        };
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
    [snapshot, compileState, contract, stationFor, effectiveBoundMineId],
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
    revision: number;
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
    if (!station && ['factory', 'mine', 'storage', 'depot'].includes(tool))
      return;
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
        ...(station ? { stationId: station.stationId } : {}),
        ...(effectiveBoundMineId ? { mineId: effectiveBoundMineId } : {}),
        ...(tool === 'mine' ? { resourceId: mineResource } : {}),
      },
      (result) => {
        if (result.validation && result.validationRevision !== undefined)
          setValidatedGhost({
            key: ghostKey,
            revision: result.validationRevision,
            result: result.validation,
          });
      },
    );
    // The intent key includes every command input; a new accepted revision invalidates the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostKey, snapshot?.revision, localResult?.valid, session]);
  const authoritative =
    validatedGhost?.key === ghostKey &&
    validatedGhost.revision === snapshot?.revision
      ? validatedGhost.result
      : undefined;
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
      ? entityAt(snapshot, hovered)?.id
      : undefined;
  const selectedEntity =
    snapshot === undefined || selectedEntityId === undefined
      ? undefined
      : snapshot.entities.find((entity) => entity.id === selectedEntityId);
  const selectedPod = snapshot?.pods.find((pod) => pod.id === selectedPodId);
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
      setRailDraft([]);
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
  const commitRail = useCallback(async () => {
    if (railDraft.length < 2 || railSubmissionRef.current) return;
    const clearance = snapshot && validateRailPath(snapshot.grid, railDraft);
    if (!clearance?.valid) {
      setError(clearance?.reason ?? 'World is not ready');
      return;
    }
    const points = railDraft;
    const context = placementContextRef.current;
    railSubmissionRef.current = true;
    setRailSubmitting(true);
    try {
      const result = await run((client) =>
        client.command({ type: 'PLACE_RAIL_PATH', points }),
      );
      if (result !== undefined && placementContextRef.current === context)
        setRailDraft((current) => {
          if (current === points) return [];
          // Preserve points added while the accepted prefix was being submitted.
          return points.every(
            (point, i) => current[i] && samePoint(current[i]!, point),
          )
            ? current.slice(points.length - 1)
            : current;
        });
    } finally {
      railSubmissionRef.current = false;
      setRailSubmitting(false);
    }
  }, [railDraft, run, snapshot]);

  const handleMapClick = useCallback(
    async (point: GridPoint) => {
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
        if (tool === 'rail') {
          setRailDraft((current) => {
            if (current.length === 0) return [point];
            const last = current.at(-1)!;
            if (last.x !== point.x && last.y !== point.y) {
              const dx = Math.abs(point.x - last.x);
              const dy = Math.abs(point.y - last.y);
              const snapped =
                dx >= dy
                  ? { x: point.x, y: last.y }
                  : { x: last.x, y: point.y };
              return samePoint(last, snapped) ? current : [...current, snapped];
            }
            return samePoint(last, point) ? current : [...current, point];
          });
          return;
        }
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
          askConfirmation({
            title: 'Dismantle building?',
            message: `Dismantling this ${target.kind} routes its contents to salvage by rail.`,
            confirmText: 'Dismantle',
            action: async () => {
              await run((client) =>
                client.command({
                  type: 'DISMANTLE_ENTITY',
                  entityId: target.id,
                }),
              );
            },
          });
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
        if (station === undefined) {
          setError('Place one free adjacent station first.');
          return;
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
              stationId: station.stationId,
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
            'Placement cancelled because the tool or factory definition changed.',
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
      tool,
      transformFor,
      askConfirmation,
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
      setRailDraft([]);
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
    setRailDraft([]);
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
  const onWorkspaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (target instanceof HTMLElement &&
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="toolbar"]',
        ))
    )
      return;
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
      setRailDraft([]);
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
    if (event.key === 'Enter' && railDraft.length >= 2) {
      event.preventDefault();
      void commitRail();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedRailEdgeId !== undefined) {
        event.preventDefault();
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
        event.preventDefault();
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
        else if (['factory', 'mine', 'storage', 'depot'].includes(entity.kind))
          askConfirmation({
            title: 'Dismantle building?',
            message: 'Its contents will be recovered through rail salvage.',
            confirmText: 'Dismantle',
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
  };
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
  const catalogueTools = tools.filter((item) =>
    `${item.label} ${item.id}`
      .toLowerCase()
      .includes(catalogueQuery.trim().toLowerCase()),
  );
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
    ['factory', 'mine', 'storage', 'depot'].includes(id)
      ? 'Requires an adjacent free station'
      : id === 'drill'
        ? `Bound mine: ${effectiveBoundMineId ?? 'select a mine first'}`
        : id === 'rail'
          ? 'Connect endpoints in one straight or orthogonal path'
          : id === 'junction'
            ? 'Places a control node; it does not occupy a tile'
            : id === 'station'
              ? '2 × 2 station anchor'
              : 'Select an existing world object';
  return (
    <div
      ref={workspaceRef}
      tabIndex={0}
      onKeyDown={onWorkspaceKeyDown}
      className={`world-workspace world-workspace--map${hidden ? ' is-hidden' : ''}${showInspector ? ' has-inspector' : ''}${showCatalogue ? ' has-catalogue' : ''}`}
      aria-hidden={hidden}
    >
      <aside className={`world-sites panel${showCatalogue ? ' is-open' : ''}`}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">World editor</span>
            <h2>Build tools</h2>
          </div>
          <span>{snapshot?.revision ?? 0}</span>
          <button
            aria-label="Close build catalogue"
            onClick={() => setShowCatalogue(false)}
          >
            ×
          </button>
        </div>
        <div
          className="world-tool-grid"
          role="toolbar"
          aria-label="World build tools"
        >
          {catalogueTools.map((item) => (
            <button
              key={item.id}
              aria-pressed={tool === item.id}
              className={tool === item.id ? 'is-active' : ''}
              onClick={() => {
                chooseTool(item.id);
              }}
            >
              <WorldThumbnail kind={item.id} />
              <span>{item.label}</span>
              <kbd>{item.key}</kbd>
              <small>
                {toolFootprint(item.id) === undefined
                  ? 'Network action'
                  : `${toolFootprint(item.id)!.width} × ${toolFootprint(item.id)!.height} tiles`}
                {toolCost(item.id).length === 0
                  ? ''
                  : ` · ${toolCost(item.id).reduce((sum, cost) => sum + cost.quantity, 0)} materials`}
              </small>
            </button>
          ))}
        </div>
        <label className="world-catalogue-search">
          <span>Search catalogue</span>
          <input
            value={catalogueQuery}
            onChange={(event) => setCatalogueQuery(event.target.value)}
            placeholder="Find a tool"
          />
        </label>
        {toolRequirement(tool).length > 0 && (
          <p className="world-catalogue-requirement">{toolRequirement(tool)}</p>
        )}
        {tool === 'rail' && (
          <div className="world-tool-options">
            <p>
              {railDraft.length === 0
                ? 'Start on the round anchor inside a station.'
                : `${railDraft.length} points · finish on another anchor`}
            </p>
            <button
              disabled={railDraft.length < 2 || railSubmitting}
              onClick={() => void commitRail()}
            >
              Finish rail
            </button>
            <button
              disabled={railDraft.length === 0}
              onClick={() => setRailDraft([])}
            >
              Cancel
            </button>
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
              Connected
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
        className="world-map world-map--three"
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
              key={`${snapshot.worldId}:${sessionState.generation}`}
              snapshot={snapshot}
              settingsOpen={showSettings}
              interactionBlocked={confirmation !== undefined}
              activeTool={tool}
              onCommitRail={() => void commitRail()}
              onCancel={() => chooseTool('select')}
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
              railDraft={railDraft}
              onSelect={(point) => void handleMapClick(point)}
              onHover={setHovered}
            />
          </Suspense>
        )}
        <div className="world-map-caption">
          <span>{tool.replaceAll('-', ' ')} tool</span>
          <small>
            Seed {snapshot?.generation.config.seed ?? seed} · right-drag to
            orbit · wheel to zoom
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
            Build catalogue
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
                ? 'Validation pending'
                : ghost.valid
                  ? 'Placement ready'
                  : 'Placement blocked'}
            </strong>
            <span>{ghost.reason ?? toolRequirement(tool)}</span>
            <small>
              {toolCost(tool)
                .map(
                  (cost) =>
                    `${cost.quantity} ${resourceById.get(cost.resourceId)?.name ?? cost.resourceId}`,
                )
                .join(' · ') || 'No construction materials'}
            </small>
          </div>
        )}
      </section>
      {tool === 'rail' && (
        <div
          className="world-rail-actions"
          role="group"
          aria-label="Rail construction"
        >
          <div role="status" aria-live="polite">
            <strong>
              {railSubmitting
                ? 'Building rail...'
                : railDraft.length < 2
                  ? 'Draw a rail path'
                  : railDraft.length -
                    1 +
                    (railDraft.length === 2
                      ? ' rail segment ready'
                      : ' rail segments ready')}
            </strong>
            <span>
              {railDraft.length === 0
                ? 'Click a start tile, then an end tile. You can also drag.'
                : railDraft.length === 1
                  ? 'Click an end tile to add the first segment.'
                  : ((snapshot &&
                      validateRailPath(snapshot.grid, railDraft).reason) ??
                    'Ends snap into existing rails. Build follows the arrow direction.')}
            </span>
          </div>
          <button
            className="world-rail-build"
            disabled={railDraft.length < 2 || railSubmitting}
            onClick={() => void commitRail()}
          >
            Build rail
          </button>
          <button
            disabled={railDraft.length === 0 || railSubmitting}
            onClick={() => {
              setRailDraft((current) => current.slice(0, -1));
              setError(undefined);
            }}
          >
            Undo point
          </button>
          <button onClick={() => chooseTool('select')}>Cancel</button>
        </div>
      )}
      <nav className="world-build-dock" aria-label="Build tools">
        <button
          aria-pressed={tool === 'select'}
          onClick={() => chooseTool('select')}
        >
          Select <kbd>S</kbd>
        </button>
        <button
          aria-pressed={tool === 'factory'}
          disabled={contract === undefined || compileState !== 'ready'}
          onClick={() => chooseTool('factory')}
        >
          Factory <kbd>F</kbd>
        </button>
        <button
          aria-pressed={tool === 'mine' || tool === 'drill'}
          onClick={() => chooseTool('mine')}
        >
          Mining <kbd>M</kbd>
        </button>
        <button
          aria-pressed={tool === 'storage' || tool === 'depot'}
          onClick={() => {
            chooseTool('storage');
            setShowCatalogue(true);
            setShowInspector(false);
          }}
        >
          Storage <kbd>B</kbd>
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
        <button
          onClick={() => {
            setShowCatalogue((value) => !value);
            setShowInspector(false);
          }}
          aria-expanded={showCatalogue}
        >
          All tools
        </button>
      </nav>
      <aside
        className={`world-inspector panel${showInspector ? ' is-open' : ''}`}
      >
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
          {snapshot?.pendingAdvanceTarget !== undefined && (
            <button
              disabled={snapshot.paused}
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
        {selectedPod !== undefined && snapshot !== undefined && (
          <section className="inspector-card world-pod-card">
            <h3>Cargo pod</h3>
            <dl>
              <div>
                <dt>State</dt>
                <dd>{selectedPod.state.toLowerCase().replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {
                    snapshot.railNodes.find(
                      (node) => node.id === selectedPod.nodeId,
                    )?.position.x
                  }
                  ,{' '}
                  {
                    snapshot.railNodes.find(
                      (node) => node.id === selectedPod.nodeId,
                    )?.position.y
                  }
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
                  <dt>Mission</dt>
                  <dd>
                    {snapshot.missions.find(
                      (mission) => mission.id === selectedPod.missionId,
                    )?.quantity ?? 'In transit'}{' '}
                    units
                  </dd>
                </div>
              )}
            </dl>
            <details>
              <summary>Developer details</summary>
              <code>{selectedPod.id}</code>
            </details>
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
                <dd>
                  {
                    snapshot?.railNodes.find(
                      (node) => node.id === selectedRailEdge.from,
                    )?.position.x
                  }
                  ,{' '}
                  {
                    snapshot?.railNodes.find(
                      (node) => node.id === selectedRailEdge.from,
                    )?.position.y
                  }
                </dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>
                  {
                    snapshot?.railNodes.find(
                      (node) => node.id === selectedRailEdge.to,
                    )?.position.x
                  }
                  ,{' '}
                  {
                    snapshot?.railNodes.find(
                      (node) => node.id === selectedRailEdge.to,
                    )?.position.y
                  }
                </dd>
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
                      Path {index + 1}: {from?.x}, {from?.y} → {to?.x}, {to?.y}
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
            <h3>Selected {selectedEntity.kind}</h3>
            <WorldBuildingInspector
              entity={selectedEntity}
              snapshot={snapshot}
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
            {(selectedEntity.kind === 'factory' ||
              selectedEntity.kind === 'mine' ||
              selectedEntity.kind === 'storage' ||
              selectedEntity.kind === 'depot') && (
              <button
                className="danger-button"
                onClick={() => {
                  askConfirmation({
                    title: 'Dismantle building?',
                    message: `Dismantling this ${selectedEntity.kind} routes its contents to salvage by rail.`,
                    confirmText: 'Dismantle',
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
                Dismantle
              </button>
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
                <input
                  aria-label="Rule priority"
                  type="number"
                  value={rulePriority}
                  onChange={(event) =>
                    setRulePriority(Number(event.target.value))
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
                        priority: rulePriority,
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
          <h3>Build blueprint · {factoryName}</h3>
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
            onClick={() => onOpenFactory(activeFactoryId)}
          >
            Open factory blueprint
          </button>
        </section>
        <section className="inspector-card">
          <h3>Accessible entities</h3>
          <ul className="world-entity-list">
            {snapshot?.entities.map((entity) => (
              <li key={entity.id}>
                <button
                  onClick={() => {
                    setSelected(entity.transform.position);
                    setSelectedEntityId(entity.id);
                    setSelectedPodId(undefined);
                    setCameraFocus(entity.transform.position);
                  }}
                >
                  {entity.kind.replaceAll('-', ' ')} ·{' '}
                  {entity.transform.position.x}, {entity.transform.position.y}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="inspector-card">
          <h3>Accessible cargo pods</h3>
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
                      Pod · {pod.state.toLowerCase().replaceAll('_', ' ')} ·{' '}
                      {node?.position.x}, {node?.position.y}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="inspector-card">
          <h3>Accessible rails</h3>
          <ul className="world-entity-list">
            {snapshot?.railEdges.map((edge, index) => (
              <li key={edge.id}>
                <button
                  onClick={() => {
                    setSelectedRailEdgeId(edge.id);
                    setSelectedEntityId(undefined);
                    setSelectedPodId(undefined);
                    setCameraFocus(edge.points[0]);
                  }}
                >
                  Rail {index + 1}: {edge.points[0]?.x}, {edge.points[0]?.y} →{' '}
                  {edge.points.at(-1)?.x}, {edge.points.at(-1)?.y}
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
            <ul className="world-entity-list">
              {snapshot?.diagnostics.map((diagnostic) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.entityIds.join('-')}`}
                >
                  <button onClick={() => focusEntities(diagnostic.entityIds)}>
                    {diagnostic.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
