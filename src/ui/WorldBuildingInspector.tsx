import { resourceById } from '../domain'
import type { ResourceId } from '../domain'
import type { WorldBuildingSnapshot, WorldEntity, WorldInventory, WorldSnapshot, WorldStationSnapshot } from '../world'

interface Props { readonly entity: WorldEntity; readonly snapshot: WorldSnapshot }

const resourceName = (id: ResourceId): string => resourceById.get(id)?.name ?? id
const percent = (quantity: number, capacity: number): number => capacity === 0 ? 0 : Math.min(100, Math.max(0, quantity / capacity * 100))
const stateClass = (state: string): string => ['RUNNING', 'ACTIVE', 'READY'].includes(state) ? 'good' : ['OUTPUT_BLOCKED', 'INVALID', 'EXHAUSTED', 'EVACUATING'].includes(state) ? 'bad' : 'waiting'
const stateLabel = (state: string): string => state.toLowerCase().replaceAll('_', ' ')

const Meter = ({ value, className = '' }: { readonly value: number; readonly className?: string }) => <span className={`world-inventory-meter ${className}`} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></span>

const Inventory = ({ title, inventory }: { readonly title: string; readonly inventory: WorldInventory }) => {
  const total = inventory.items.reduce((sum, item) => sum + item.quantity, 0)
  return <div className="world-inventory"><div className="world-inventory-heading"><strong>{title}</strong><span>{total} / {inventory.capacity}</span></div><Meter value={percent(total, inventory.capacity)} />{inventory.items.length === 0 ? <p className="world-empty-state">Empty</p> : <ul>{inventory.items.map((item) => <li key={item.resourceId}><span className="world-resource-dot" style={{ background: resourceById.get(item.resourceId)?.colour }} /><span>{resourceName(item.resourceId)}</span><b>{item.quantity}</b></li>)}</ul>}</div>
}

const FactoryState = ({ state }: { readonly state: Extract<WorldBuildingSnapshot, { kind: 'factory' }> }) => <>
  <div className="world-building-status"><span>Machine state</span><b className={`badge ${stateClass(state.state)}`}>{stateLabel(state.state)}</b></div>
  {state.nextEventAt !== undefined && <p className="world-runtime-note">Next transition at {(Number(state.nextEventAt) / 1_000_000).toFixed(2)}s</p>}
  <div className="world-buffer-group"><h4>Input buffers</h4>{state.inputs.length === 0 ? <p className="world-empty-state">No inputs</p> : state.inputs.map((buffer) => <div className="world-buffer" key={buffer.resourceId}><div><span>{resourceName(buffer.resourceId)}</span><b>{buffer.quantity} / {buffer.capacity}</b></div><Meter value={percent(buffer.quantity, buffer.capacity)} /><small>Internal WIP <b>{buffer.wipPercent.toFixed(1)}%</b></small><Meter value={buffer.wipPercent} className="is-wip" /></div>)}</div>
  <div className="world-buffer-group"><h4>Output buffers</h4>{state.outputs.length === 0 ? <p className="world-empty-state">No outputs</p> : state.outputs.map((buffer) => <div className="world-buffer" key={buffer.resourceId}><div><span>{resourceName(buffer.resourceId)}</span><b>{buffer.quantity} / {buffer.capacity}</b></div><Meter value={percent(buffer.quantity, buffer.capacity)} /><small>Work in progress <b>{buffer.wipPercent.toFixed(1)}%</b></small><Meter value={buffer.wipPercent} className="is-wip" /></div>)}</div>
</>

const MineState = ({ state }: { readonly state: Extract<WorldBuildingSnapshot, { kind: 'mine' }> }) => <>
  <div className="world-buffer-group"><h4>Extraction output</h4><div className="world-buffer"><div><span>{resourceName(state.output.resourceId)}</span><b>{state.output.quantity} / {state.output.capacity}</b></div><Meter value={percent(state.output.quantity, state.output.capacity)} /></div></div>
  <dl className="world-building-counts"><div><dt>Active drills</dt><dd>{state.drills.active}</dd></div><div><dt>Ghost drills</dt><dd>{state.drills.ghost}</dd></div><div><dt>Exhausted drills</dt><dd>{state.drills.exhausted}</dd></div></dl>
  <Inventory title="Drill construction" inventory={state.construction} />
  <Inventory title="Salvage" inventory={state.salvage} />
</>

const Logistics = ({ stations }: { readonly stations: readonly WorldStationSnapshot[] }) => stations.length === 0 ? null : <div className="world-logistics-state"><h4>Logistics</h4>{stations.map((station) => <div className="world-logistics-row" key={station.id}><div><span>{station.resourceId === undefined ? 'Pod berth' : resourceName(station.resourceId)}</span><b>{station.role}</b></div>{station.quantity !== undefined && station.capacity !== undefined && <><small>Buffer {station.quantity} / {station.capacity} · target {station.target}</small><Meter value={percent(station.quantity, station.capacity)} /></>}</div>)}</div>

export const WorldBuildingInspector = ({ entity, snapshot }: Props) => {
  const state = snapshot.buildings.find((item) => item.entityId === entity.id)
  const linkedStation = entity.kind === 'station' ? entity : snapshot.entities.find((item) => item.kind === 'station' && item.linkedEntityId === entity.id)
  const stations = linkedStation?.kind === 'station' ? snapshot.stations.filter((item) => item.railNodeId === linkedStation.railNodeId) : []
  const entityState = 'state' in entity ? entity.state : undefined
  return <>
    <div className="world-building-identity"><p title={entity.id}>{entity.id}</p>{entityState !== undefined && <span className={`badge ${stateClass(entityState)}`}>{stateLabel(entityState)}</span>}</div>
    <dl className="world-building-counts"><div><dt>Position</dt><dd>{entity.transform.position.x}, {entity.transform.position.y}</dd></div><div><dt>Footprint</dt><dd>{entity.transform.size.width} × {entity.transform.size.height}</dd></div></dl>
    {state?.kind === 'factory' && <FactoryState state={state} />}
    {state?.kind === 'storage' && <Inventory title="Shared inventory" inventory={state.inventory} />}
    {state?.kind === 'mine' && <MineState state={state} />}
    {state?.kind === 'depot' && <div className="world-buffer-group"><h4>Pod slots</h4><div className="world-buffer"><div><span>Pods at depot</span><b>{state.podCount} / {state.podCapacity}</b></div><Meter value={percent(state.podCount, state.podCapacity)} /></div></div>}
    {entity.kind === 'construction-site' && <Inventory title="Construction materials" inventory={{ capacity: entity.required.reduce((sum, item) => sum + item.quantity, 0), items: entity.delivered }} />}
    {entity.kind === 'drill' && <dl className="world-building-counts"><div><dt>Resource</dt><dd>{resourceName(entity.resourceId)}</dd></div><div><dt>Mine</dt><dd>{entity.mineId}</dd></div></dl>}
    <Logistics stations={stations} />
  </>
}
