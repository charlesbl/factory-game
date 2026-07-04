import { formatRate, resourceById } from '../domain'
import type { FactoryId } from '../domain'
import type { FactoryContract } from '../compiler'
import type { FactoryBlueprint } from '../editor'
import type { InstanceSnapshot } from '../simulation'

const stateTone: Record<string, string> = {
  RUNNING: 'good',
  WAITING_INPUT: 'waiting',
  OUTPUT_BLOCKED: 'blocked',
  PAUSED: 'muted',
  INVALID: 'bad',
  MAINTENANCE: 'bad',
}

interface Props {
  readonly blueprint: FactoryBlueprint
  readonly factories: readonly { readonly id: FactoryId; readonly name: string }[]
  readonly activeFactoryId: FactoryId
  readonly factoryName: string
  readonly contract: FactoryContract | undefined
  readonly compileState: 'compiling' | 'ready' | 'invalid'
  readonly snapshot: InstanceSnapshot | undefined
  readonly logicalTime: bigint
  readonly scheduledEvents: number
  readonly sleepingActors: number
  readonly onSelectFactory: (factoryId: FactoryId) => void
  readonly onOpenFactory: () => void
  readonly onSupply: () => void
  readonly onAdvance: () => void
  readonly onCollect: () => void
}

export const WorldView = ({ blueprint, factories, activeFactoryId, factoryName, contract, compileState, snapshot, logicalTime, scheduledEvents, sleepingActors, onSelectFactory, onOpenFactory, onSupply, onAdvance, onCollect }: Props) => {
  const state = snapshot?.state ?? (compileState === 'invalid' ? 'INVALID' : 'PAUSED')
  const buffers = [...(snapshot?.inputs ?? []), ...(snapshot?.outputs ?? [])]
  const storedItems = buffers.reduce((total, buffer) => total + buffer.quantity, 0)
  const totalCapacity = buffers.reduce((total, buffer) => total + buffer.capacity, 0)

  const renderBuffer = (buffer: InstanceSnapshot['inputs'][number], role: 'input' | 'output') => {
    const resource = resourceById.get(buffer.resourceId)
    const rate = role === 'input' ? contract?.inputRates.get(buffer.resourceId) : contract?.outputRates.get(buffer.resourceId)
    const ports = role === 'input' ? contract?.inputPorts : contract?.outputPorts
    const maximumRate = ports?.filter((port) => port.resourceId === buffer.resourceId).reduce((total, port) => total + port.capacity, 0n) ?? 0n
    const utilisation = maximumRate === 0n || rate === undefined ? 0 : Math.min(100, Number((rate * 100n) / maximumRate))
    return <article className={`world-port world-port--${role}`} key={`${role}-${buffer.resourceId}`}>
      <div><i style={{ background: resource?.colour }} /><span>{resource?.name ?? buffer.resourceId}</span><b>{buffer.quantity}/{buffer.capacity}</b></div>
      <div className="world-buffer-track"><i style={{ width: `${buffer.capacity === 0 ? 0 : buffer.quantity / buffer.capacity * 100}%`, background: resource?.colour }} /></div>
      <div className="world-port-rate">
        <span>Contract rate</span>
        <b>{rate === undefined ? '0' : formatRate(rate)}/s</b>
        <small>max {formatRate(maximumRate)}/s · {utilisation}%</small>
      </div>
      <div className="world-rate-track" title={`${utilisation}% of boundary capacity`}><i style={{ width: `${utilisation}%`, background: resource?.colour }} /></div>
    </article>
  }

  return <div className="world-workspace">
    <aside className="world-sites panel">
      <div className="panel-heading"><div><span className="eyebrow">World</span><h2>Production sites</h2></div><span>{factories.length}</span></div>
      <div className="world-site-list">
        {factories.map((factory, index) => {
          const isActive = factory.id === activeFactoryId
          return <button key={factory.id} className={`world-site ${isActive ? 'is-active' : ''}`} aria-label={`View ${factory.name} in world`} aria-pressed={isActive} onClick={() => onSelectFactory(factory.id)}>
            <span className="world-site-mark">F{index + 1}</span>
            <span><strong>{factory.name}</strong><small>{isActive ? contract === undefined ? 'Contract unavailable' : `${contract.footprint.width} × ${contract.footprint.height} m footprint` : 'Select production site'}</small></span>
            <i className={`status-dot ${isActive ? compileState : 'muted'}`} />
          </button>
        })}
      </div>
      <section className="world-summary">
        <span className="eyebrow">Network summary</span>
        <dl><div><dt>Factories</dt><dd>{factories.length}</dd></div><div><dt>Stored items</dt><dd>{storedItems}/{totalCapacity}</dd></div><div><dt>Active deliveries</dt><dd>0</dd></div></dl>
      </section>
    </aside>

    <section className="world-map" aria-label="World overview">
      <div className="world-map-caption"><span>World overview</span><small>Factory boundaries and discrete buffers</small></div>
      <div className="world-flow world-flow--inputs">
        <span className="world-flow-label">Inputs</span>
        {snapshot?.inputs.map((buffer) => renderBuffer(buffer, 'input'))}
      </div>
      <button className="world-factory" onClick={onOpenFactory} aria-label={`Open ${factoryName} factory`}>
        <span className="world-factory-icon">F</span>
        <span className={`badge ${stateTone[state]}`}>{state.replace('_', ' ')}</span>
        <strong>{factoryName}</strong>
        <small>Compiled factory actor</small>
        <span className="world-factory-stats"><b>{blueprint.nodes.size}</b> nodes <b>{blueprint.edges.size}</b> routes</span>
        <em>Open factory →</em>
      </button>
      <div className="world-flow world-flow--outputs">
        <span className="world-flow-label">Outputs</span>
        {snapshot?.outputs.map((buffer) => renderBuffer(buffer, 'output'))}
      </div>
    </section>

    <aside className="world-inspector panel">
      <div className="panel-heading"><div><span className="eyebrow">Operate</span><h2>World runtime</h2></div><span className={`badge ${stateTone[state]}`}>{state.replace('_', ' ')}</span></div>
      <section className="inspector-card">
        <h3>Time controls</h3>
        <div className="world-runtime-actions"><button onClick={onSupply}>Supply +12</button><button className="primary" onClick={onAdvance}>Run 5 s</button><button onClick={onCollect}>Collect all</button></div>
        <small className="world-clock">Logical time {Number(logicalTime) / 1_000_000}s</small>
      </section>
      <section className="inspector-card">
        <h3>Scheduler</h3>
        <dl><div><dt>Scheduled events</dt><dd>{scheduledEvents}</dd></div><div><dt>Sleeping actors</dt><dd>{sleepingActors}</dd></div><div><dt>Work generation</dt><dd>{snapshot?.generation ?? 0}</dd></div></dl>
      </section>
      <section className="inspector-card world-layer-note">
        <h3>World layer</h3>
        <p>Items in this view are discrete integers. Open the factory to edit its continuous production graph.</p>
        <button onClick={onOpenFactory}>Edit factory blueprint</button>
      </section>
    </aside>
  </div>
}
