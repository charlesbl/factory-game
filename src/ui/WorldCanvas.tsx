import { Application, Container, Graphics } from 'pixi.js';
import { useEffect, useRef } from 'react';
import type {
  GridPoint,
  RailEdgeId,
  RailNodeId,
  WorldEntityId,
} from '../domain';
import {
  OreKind,
  TerrainKind,
  occupiedCells,
  type WorldSnapshot,
  type WorldTransform,
} from '../world';
import { railNodeConnectionState, railNodeDegrees } from './worldRailVisual';
import {
  podPositionAt,
  smoothVisualPoint,
  visualLogicalTime,
  WORLD_RENDER_MAX_FPS,
  type VisualPoint,
} from './worldAnimation';

const CELL = 8;
const CHUNK = 32;
interface Ghost {
  readonly transform: WorldTransform;
  readonly valid: boolean;
}
interface Props {
  readonly snapshot: WorldSnapshot;
  readonly selected?: GridPoint;
  readonly ghost?: Ghost;
  readonly railDraft: readonly GridPoint[];
  readonly hoveredRailEdgeId?: RailEdgeId;
  readonly hoveredDismantleEntityId?: WorldEntityId;
  readonly selectedRailEdgeId?: RailEdgeId;
  readonly railPlacement: boolean;
  readonly onSelect: (point: GridPoint) => void;
  readonly onHover: (point?: GridPoint) => void;
  readonly onRailPreview: (points: readonly GridPoint[]) => void;
  readonly onRailPlace: (points: readonly [GridPoint, GridPoint]) => void;
}
interface Scene {
  readonly app: Application;
  readonly camera: Container;
  readonly terrain: Container;
  readonly ore: Container;
  readonly rail: Graphics;
  readonly entities: Graphics;
  readonly reservations: Graphics;
  readonly pods: Graphics;
  readonly overlay: Graphics;
  readonly chunks: Container[];
  worldId?: string;
  snapshot?: WorldSnapshot;
  receivedAt: number;
  oreRemaining: WorldSnapshot['grid']['oreRemaining'] | undefined;
  railKey: string | undefined;
  entityKey: string | undefined;
  reservationKey: string | undefined;
  nodePositions: ReadonlyMap<RailNodeId, GridPoint>;
  readonly podPositions: Map<string, VisualPoint>;
}

const railVisualKey = (snapshot: WorldSnapshot): string =>
  `${snapshot.railEdges
    .map(
      (edge) =>
        `${edge.id}:${edge.from}:${edge.to}:${edge.points.map((point) => `${point.x},${point.y}`).join(';')}`,
    )
    .join('|')}#${snapshot.railNodes
    .map(
      (node) => `${node.id}:${node.kind}:${node.position.x},${node.position.y}`,
    )
    .join('|')}`;

const entityVisualKey = (snapshot: WorldSnapshot): string =>
  snapshot.entities
    .map((entity) => {
      const transform = entity.transform;
      const state = 'state' in entity ? String(entity.state) : '';
      const progress =
        entity.kind === 'construction-site'
          ? `${entity.required.map((item) => item.quantity).join(',')}/${entity.delivered.map((item) => item.quantity).join(',')}`
          : '';
      return `${entity.id}:${entity.kind}:${transform.position.x},${transform.position.y}:${transform.size.width},${transform.size.height}:${transform.rotation}:${state}:${progress}`;
    })
    .join('|');

const reservationVisualKey = (snapshot: WorldSnapshot): string =>
  snapshot.railBlocks
    .map(
      (block) =>
        `${block.id}:${block.occupantId ?? ''}:${block.reservedById ?? ''}`,
    )
    .join('|');

const drawScene = (scene: Scene, snapshot: WorldSnapshot): void => {
  scene.snapshot = snapshot;
  scene.receivedAt = performance.now();
  scene.nodePositions = new Map(
    snapshot.railNodes.map((node) => [node.id, node.position]),
  );
  if (scene.worldId !== snapshot.worldId) {
    scene.worldId = snapshot.worldId;
    scene.oreRemaining = undefined;
    scene.railKey = undefined;
    scene.entityKey = undefined;
    scene.reservationKey = undefined;
    scene.podPositions.clear();
    scene.terrain
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    scene.ore
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    scene.chunks.length = 0;
    for (let cy = 0; cy < Math.ceil(snapshot.grid.height / CHUNK); cy += 1)
      for (let cx = 0; cx < Math.ceil(snapshot.grid.width / CHUNK); cx += 1) {
        const terrain = new Graphics();
        const chunk = new Container();
        chunk.label = `${cx}:${cy}`;
        for (
          let y = cy * CHUNK;
          y < Math.min(snapshot.grid.height, (cy + 1) * CHUNK);
          y += 1
        )
          for (
            let x = cx * CHUNK;
            x < Math.min(snapshot.grid.width, (cx + 1) * CHUNK);
            x += 1
          ) {
            const index = y * snapshot.grid.width + x;
            terrain
              .rect(x * CELL, y * CELL, CELL, CELL)
              .fill(
                snapshot.grid.terrain[index] === TerrainKind.OBSTACLE
                  ? '#14231e'
                  : (x + y) % 2 === 0
                    ? '#0b1814'
                    : '#0c1a15',
              );
          }
        chunk.addChild(terrain);
        scene.terrain.addChild(chunk);
        scene.chunks.push(chunk);
      }
  }
  if (scene.oreRemaining !== snapshot.grid.oreRemaining) {
    scene.oreRemaining = snapshot.grid.oreRemaining;
    scene.ore
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    for (let cy = 0; cy < Math.ceil(snapshot.grid.height / CHUNK); cy += 1)
      for (let cx = 0; cx < Math.ceil(snapshot.grid.width / CHUNK); cx += 1) {
        const ores = new Graphics();
        for (
          let y = cy * CHUNK;
          y < Math.min(snapshot.grid.height, (cy + 1) * CHUNK);
          y += 1
        )
          for (
            let x = cx * CHUNK;
            x < Math.min(snapshot.grid.width, (cx + 1) * CHUNK);
            x += 1
          ) {
            const index = y * snapshot.grid.width + x;
            if (snapshot.grid.oreRemaining[index] === 0) continue;
            if (snapshot.grid.oreKinds[index] === OreKind.IRON)
              ores
                .rect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
                .fill({ color: '#b86e43', alpha: 0.78 });
            else if (snapshot.grid.oreKinds[index] === OreKind.COPPER)
              ores
                .rect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
                .fill({ color: '#5fb5aa', alpha: 0.78 });
          }
        scene.ore.addChild(ores);
      }
  }
  const degrees = railNodeDegrees(snapshot.railEdges);
  const nextRailKey = railVisualKey(snapshot);
  if (scene.railKey !== nextRailKey) {
    scene.railKey = nextRailKey;
    scene.rail.clear();
    for (const edge of snapshot.railEdges) {
      const first = edge.points[0];
      if (first === undefined) continue;
      const colour = '#63bfa5';
      scene.rail.moveTo(first.x * CELL + CELL / 2, first.y * CELL + CELL / 2);
      for (const point of edge.points.slice(1))
        scene.rail.lineTo(point.x * CELL + CELL / 2, point.y * CELL + CELL / 2);
      scene.rail.stroke({ color: colour, width: 3 });
      const end = edge.points.at(-1)!;
      const prior = edge.points.at(-2) ?? first;
      const dx = Math.sign(end.x - prior.x);
      const dy = Math.sign(end.y - prior.y);
      const ex = end.x * CELL + CELL / 2;
      const ey = end.y * CELL + CELL / 2;
      scene.rail
        .poly([
          ex,
          ey,
          ex - dx * 5 - dy * 3,
          ey - dy * 5 + dx * 3,
          ex - dx * 5 + dy * 3,
          ey - dy * 5 - dx * 3,
        ])
        .fill(colour);
    }
  }
  const nextEntityKey = `${entityVisualKey(snapshot)}#${nextRailKey}`;
  if (scene.entityKey !== nextEntityKey) {
    scene.entityKey = nextEntityKey;
    scene.entities.clear();
    const colours: Record<string, string> = {
      factory: '#5fae88',
      mine: '#c97946',
      drill: '#d39a5f',
      station: '#8eabc2',
      storage: '#a58ad0',
      depot: '#e0bd63',
      'construction-site': '#d48c53',
    };
    for (const entity of snapshot.entities) {
      if (entity.kind === 'construction-site') {
        const cells = occupiedCells(entity.transform);
        const totalRequired = entity.required.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
        const totalDelivered = entity.delivered.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
        const progress =
          totalRequired === 0 ? 1 : Math.min(totalDelivered / totalRequired, 1);
        const builtCount = Math.floor(progress * cells.length);
        const builtColor = colours[entity.targetKind] ?? '#6fd0a6';
        for (let index = 0; index < cells.length; index += 1) {
          const cell = cells[index]!;
          const isBuilt = index < builtCount;
          scene.entities
            .rect(cell.x * CELL, cell.y * CELL, CELL, CELL)
            .fill({
              color: isBuilt ? builtColor : '#d48c53',
              alpha: isBuilt ? 0.85 : 0.35,
            })
            .stroke({ color: '#d9eee5', width: isBuilt ? 1 : 0.5 });
        }
      } else {
        const width =
          (entity.transform.rotation % 2 === 0
            ? entity.transform.size.width
            : entity.transform.size.height) * CELL;
        const height =
          (entity.transform.rotation % 2 === 0
            ? entity.transform.size.height
            : entity.transform.size.width) * CELL;
        const dismantling =
          entity.kind === 'factory' &&
          'state' in entity &&
          entity.state === 'DISMANTLING';
        scene.entities
          .rect(
            entity.transform.position.x * CELL,
            entity.transform.position.y * CELL,
            width,
            height,
          )
          .fill({
            color: dismantling
              ? '#d46c53'
              : (colours[entity.kind] ?? '#6fd0a6'),
            alpha: dismantling
              ? 0.6
              : entity.kind === 'drill' && entity.state === 'GHOST'
                ? 0.45
                : 0.85,
          })
          .stroke({
            color: dismantling ? '#ff817c' : '#d9eee5',
            width: dismantling ? 2 : 1,
          });
      }
    }
    for (const node of snapshot.railNodes) {
      const connected = railNodeConnectionState(node, degrees) === 'connected';
      if (node.kind === 'endpoint' && connected) continue;
      const x = node.position.x * CELL + CELL / 2;
      const y = node.position.y * CELL + CELL / 2;
      const colour = connected ? '#91e0bb' : '#ff817c';
      const radius =
        node.kind === 'station' || node.kind === 'depot' ? 3.5 : 2.5;
      scene.entities
        .circle(x, y, radius)
        .fill('#07100d')
        .stroke({ color: colour, width: 1.5 });
      if (node.kind === 'station' || node.kind === 'depot')
        scene.entities.circle(x, y, 1.25).fill(colour);
    }
  }
  const nextReservationKey = reservationVisualKey(snapshot);
  if (scene.reservationKey !== nextReservationKey) {
    scene.reservationKey = nextReservationKey;
    scene.reservations.clear();
    for (const block of snapshot.railBlocks)
      if (block.occupantId !== undefined || block.reservedById !== undefined) {
        const edge = snapshot.railEdges.find(
          (item) => item.id === block.edgeId,
        );
        const a = edge?.points[0];
        const b = edge?.points.at(-1);
        if (a !== undefined && b !== undefined)
          scene.reservations
            .circle(
              ((a.x + b.x + 1) * CELL) / 2,
              ((a.y + b.y + 1) * CELL) / 2,
              3,
            )
            .fill(block.occupantId === undefined ? '#f4d35e' : '#ef6f6c');
      }
  }
};

export const WorldCanvas = ({
  snapshot,
  selected,
  ghost,
  railDraft,
  hoveredRailEdgeId,
  hoveredDismantleEntityId,
  selectedRailEdgeId,
  railPlacement,
  onSelect,
  onHover,
  onRailPreview,
  onRailPlace,
}: Props) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | undefined>(undefined);
  const snapshotRef = useRef(snapshot);
  const selectRef = useRef(onSelect);
  const hoverRef = useRef(onHover);
  const railPlacementRef = useRef(railPlacement);
  const railPreviewRef = useRef(onRailPreview);
  const railPlaceRef = useRef(onRailPlace);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    selectRef.current = onSelect;
    hoverRef.current = onHover;
    railPlacementRef.current = railPlacement;
    railPreviewRef.current = onRailPreview;
    railPlaceRef.current = onRailPlace;
  }, [onHover, onRailPlace, onRailPreview, onSelect, railPlacement]);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    let disposed = false;
    let interaction: 'pan' | 'rail' | undefined;
    let railStart: GridPoint | undefined;
    let spacePressed = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    const initialise = async () => {
      const app = new Application();
      await app.init({
        resizeTo: host,
        preference: 'webgl',
        antialias: false,
        background: '#07100d',
        autoDensity: true,
        resolution: Math.min(devicePixelRatio, 2),
      });
      app.ticker.maxFPS = WORLD_RENDER_MAX_FPS;
      if (disposed) {
        app.destroy(true);
        return;
      }
      host.replaceChildren(app.canvas);
      app.canvas.setAttribute('aria-label', 'Procedural world map');
      app.canvas.setAttribute('role', 'application');
      app.canvas.tabIndex = 0;
      const camera = new Container();
      const terrain = new Container();
      const ore = new Container();
      const rail = new Graphics();
      const entities = new Graphics();
      const reservations = new Graphics();
      const pods = new Graphics();
      const overlay = new Graphics();
      camera.addChild(
        terrain,
        ore,
        rail,
        entities,
        reservations,
        pods,
        overlay,
      );
      app.stage.addChild(camera);
      const initial = snapshotRef.current;
      const scene: Scene = {
        app,
        camera,
        terrain,
        ore,
        rail,
        entities,
        reservations,
        pods,
        overlay,
        chunks: [],
        receivedAt: performance.now(),
        oreRemaining: undefined,
        railKey: undefined,
        entityKey: undefined,
        reservationKey: undefined,
        nodePositions: new Map(),
        podPositions: new Map(),
      };
      sceneRef.current = scene;
      drawScene(scene, initial);
      const fit = () => {
        const scale =
          Math.min(
            host.clientWidth / (initial.grid.width * CELL),
            host.clientHeight / (initial.grid.height * CELL),
          ) * 0.92;
        camera.scale.set(scale);
        camera.position.set(
          (host.clientWidth - initial.grid.width * CELL * scale) / 2,
          (host.clientHeight - initial.grid.height * CELL * scale) / 2,
        );
      };
      fit();
      const updateCulling = () => {
        const scale = camera.scale.x;
        for (const chunk of scene.chunks) {
          const [cx, cy] = chunk.label.split(':').map(Number);
          const left = camera.x + cx! * CHUNK * CELL * scale;
          const top = camera.y + cy! * CHUNK * CELL * scale;
          const size = CHUNK * CELL * scale;
          chunk.visible =
            left < host.clientWidth &&
            top < host.clientHeight &&
            left + size > 0 &&
            top + size > 0;
        }
      };
      const pointFrom = (clientX: number, clientY: number): GridPoint => ({
        x: Math.floor(
          (clientX - host.getBoundingClientRect().left - camera.x) /
            camera.scale.x /
            CELL,
        ),
        y: Math.floor(
          (clientY - host.getBoundingClientRect().top - camera.y) /
            camera.scale.y /
            CELL,
        ),
      });
      const inside = (point: GridPoint) =>
        point.x >= 0 &&
        point.y >= 0 &&
        point.x < (scene.snapshot?.grid.width ?? 0) &&
        point.y < (scene.snapshot?.grid.height ?? 0);
      const down = (event: PointerEvent) => {
        const point = pointFrom(event.clientX, event.clientY);
        if (
          railPlacementRef.current &&
          event.button === 0 &&
          !spacePressed &&
          inside(point)
        ) {
          interaction = 'rail';
          railStart = point;
          railPreviewRef.current([point]);
        } else interaction = 'pan';
        downX = lastX = event.clientX;
        downY = lastY = event.clientY;
        app.canvas.setPointerCapture(event.pointerId);
      };
      const move = (event: PointerEvent) => {
        const point = pointFrom(event.clientX, event.clientY);
        hoverRef.current(inside(point) ? point : undefined);
        if (interaction === 'rail' && railStart !== undefined) {
          if (!inside(point)) return;
          const dx = Math.abs(point.x - railStart.x);
          const dy = Math.abs(point.y - railStart.y);
          const snapped =
            dx >= dy
              ? { x: point.x, y: railStart.y }
              : { x: railStart.x, y: point.y };
          railPreviewRef.current([railStart, snapped]);
          return;
        }
        if (interaction !== 'pan') return;
        camera.x += event.clientX - lastX;
        camera.y += event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        updateCulling();
      };
      const up = (event: PointerEvent) => {
        if (interaction === 'rail' && railStart !== undefined) {
          const point = pointFrom(event.clientX, event.clientY);
          if (inside(point)) {
            const dx = Math.abs(point.x - railStart.x);
            const dy = Math.abs(point.y - railStart.y);
            const snapped =
              dx >= dy
                ? { x: point.x, y: railStart.y }
                : { x: railStart.x, y: point.y };
            if (snapped.x !== railStart.x || snapped.y !== railStart.y)
              railPlaceRef.current([railStart, snapped]);
          }
          railPreviewRef.current([]);
          interaction = undefined;
          railStart = undefined;
          return;
        }
        const moved =
          Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY);
        interaction = undefined;
        if (moved < 3) {
          const point = pointFrom(event.clientX, event.clientY);
          if (inside(point)) selectRef.current(point);
        }
      };
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        const before = pointFrom(event.clientX, event.clientY);
        const scale = Math.max(
          0.2,
          Math.min(5, camera.scale.x * (event.deltaY < 0 ? 1.15 : 0.87)),
        );
        camera.scale.set(scale);
        const rect = host.getBoundingClientRect();
        camera.x = event.clientX - rect.left - before.x * CELL * scale;
        camera.y = event.clientY - rect.top - before.y * CELL * scale;
        updateCulling();
      };
      const key = (event: KeyboardEvent) => {
        if (event.key === ' ') spacePressed = event.type === 'keydown';
        const amount = event.shiftKey ? 80 : 24;
        if (event.key === 'ArrowLeft') camera.x += amount;
        else if (event.key === 'ArrowRight') camera.x -= amount;
        else if (event.key === 'ArrowUp') camera.y += amount;
        else if (event.key === 'ArrowDown') camera.y -= amount;
        else if (event.key === '+' || event.key === '=')
          camera.scale.set(Math.min(5, camera.scale.x * 1.15));
        else if (event.key === '-')
          camera.scale.set(Math.max(0.2, camera.scale.x * 0.87));
        else return;
        event.preventDefault();
        updateCulling();
      };
      const keyUp = (event: KeyboardEvent) => {
        if (event.key === ' ') spacePressed = false;
      };
      const cancel = () => {
        interaction = undefined;
        railStart = undefined;
        railPreviewRef.current([]);
      };
      const contextMenu = (event: MouseEvent) => event.preventDefault();
      app.canvas.addEventListener('pointerdown', down);
      app.canvas.addEventListener('pointermove', move);
      app.canvas.addEventListener('pointerleave', () =>
        hoverRef.current(undefined),
      );
      app.canvas.addEventListener('pointerup', up);
      app.canvas.addEventListener('pointercancel', cancel);
      app.canvas.addEventListener('wheel', wheel, { passive: false });
      app.canvas.addEventListener('keydown', key);
      app.canvas.addEventListener('keyup', keyUp);
      app.canvas.addEventListener('contextmenu', contextMenu);
      updateCulling();
      app.ticker.add((ticker) => {
        const current = scene.snapshot;
        if (current === undefined) return;
        scene.pods.clear();
        const logicalNow = visualLogicalTime(
          current,
          scene.receivedAt,
          performance.now(),
        );
        const activePodIds = new Set<string>();
        for (const pod of current.pods) {
          activePodIds.add(pod.id);
          const target = podPositionAt(pod, scene.nodePositions, logicalNow);
          if (target !== undefined) {
            const point = smoothVisualPoint(
              scene.podPositions.get(pod.id),
              target,
              ticker.deltaMS,
            );
            scene.podPositions.set(pod.id, point);
            scene.pods
              .circle(point.x * CELL + CELL / 2, point.y * CELL + CELL / 2, 3)
              .fill(
                pod.state === 'DESTINATION_BLOCKED' ||
                  pod.state === 'GRIDLOCKED'
                  ? '#ef6f6c'
                  : '#f4d35e',
              );
          }
        }
        for (const podId of scene.podPositions.keys())
          if (!activePodIds.has(podId)) scene.podPositions.delete(podId);
      });
    };
    void initialise();
    return () => {
      disposed = true;
      const app = sceneRef.current?.app;
      sceneRef.current = undefined;
      app?.destroy(true, { children: true });
    };
  }, []);
  useEffect(() => {
    if (sceneRef.current !== undefined) drawScene(sceneRef.current, snapshot);
  }, [snapshot]);
  useEffect(() => {
    const overlay = sceneRef.current?.overlay;
    if (overlay === undefined) return;
    overlay.clear();
    if (selected !== undefined)
      overlay
        .rect(selected.x * CELL, selected.y * CELL, CELL, CELL)
        .stroke({ color: '#ffffff', width: 1.5 });
    if (railDraft.length > 0) {
      overlay.moveTo(
        railDraft[0]!.x * CELL + CELL / 2,
        railDraft[0]!.y * CELL + CELL / 2,
      );
      for (const point of railDraft.slice(1))
        overlay.lineTo(point.x * CELL + CELL / 2, point.y * CELL + CELL / 2);
      overlay.stroke({ color: '#f4d35e', width: 2 });
      const end = railDraft.at(-1);
      const start = railDraft[0];
      if (start !== undefined && end !== undefined && railDraft.length > 1) {
        const dx = Math.sign(end.x - start.x);
        const dy = Math.sign(end.y - start.y);
        const ex = end.x * CELL + CELL / 2;
        const ey = end.y * CELL + CELL / 2;
        overlay
          .poly([
            ex,
            ey,
            ex - dx * 5 - dy * 3,
            ey - dy * 5 + dx * 3,
            ex - dx * 5 + dy * 3,
            ey - dy * 5 - dx * 3,
          ])
          .fill('#f4d35e');
      }
    }
    if (hoveredRailEdgeId !== undefined) {
      const edge = snapshotRef.current.railEdges.find(
        (candidate) => candidate.id === hoveredRailEdgeId,
      );
      const first = edge?.points[0];
      if (edge !== undefined && first !== undefined) {
        overlay.moveTo(first.x * CELL + CELL / 2, first.y * CELL + CELL / 2);
        for (const point of edge.points.slice(1))
          overlay.lineTo(point.x * CELL + CELL / 2, point.y * CELL + CELL / 2);
        overlay.stroke({ color: '#ff625c', width: 5, alpha: 0.8 });
      }
    }
    if (selectedRailEdgeId !== undefined) {
      const edge = snapshotRef.current.railEdges.find(
        (candidate) => candidate.id === selectedRailEdgeId,
      );
      const first = edge?.points[0];
      if (edge !== undefined && first !== undefined) {
        overlay.moveTo(first.x * CELL + CELL / 2, first.y * CELL + CELL / 2);
        for (const point of edge.points.slice(1))
          overlay.lineTo(point.x * CELL + CELL / 2, point.y * CELL + CELL / 2);
        overlay.stroke({ color: '#ffffff', width: 3, alpha: 0.9 });
      }
    }
    if (hoveredDismantleEntityId !== undefined) {
      const entity = snapshotRef.current.entities.find(
        (e) => e.id === hoveredDismantleEntityId,
      );
      if (entity !== undefined) {
        const width =
          (entity.transform.rotation % 2 === 0
            ? entity.transform.size.width
            : entity.transform.size.height) * CELL;
        const height =
          (entity.transform.rotation % 2 === 0
            ? entity.transform.size.height
            : entity.transform.size.width) * CELL;
        overlay
          .rect(
            entity.transform.position.x * CELL,
            entity.transform.position.y * CELL,
            width,
            height,
          )
          .stroke({ color: '#ff625c', width: 3, alpha: 0.9 });
      }
    }
    if (ghost !== undefined)
      for (const cell of occupiedCells(ghost.transform))
        overlay
          .rect(cell.x * CELL, cell.y * CELL, CELL, CELL)
          .fill({ color: ghost.valid ? '#5fae88' : '#ef6f6c', alpha: 0.28 })
          .stroke({ color: ghost.valid ? '#91e0bb' : '#ff9693', width: 1 });
  }, [
    ghost,
    hoveredDismantleEntityId,
    hoveredRailEdgeId,
    railDraft,
    selected,
    selectedRailEdgeId,
  ]);
  return <div className="world-pixi-canvas" ref={hostRef} />;
};
