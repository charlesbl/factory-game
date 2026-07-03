import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asId, createIdFactory, formatRate, gridPoint, recipes, resourceById, resources } from './domain'
import type { RecipeId, ResourceId } from './domain'
import type { CompileDiagnostic, FactoryContract } from './compiler'
import { diagnosticText } from './compiler'
import type { FactoryBlueprint } from './editor'
import { addExternalPort, addNode, BlueprintHistory, createJunctionNode, disconnectEdge, duplicateNodes, removeNode, routeCapacity, routePhysicalLength, routeResource, routeSections, transaction, type EditCommand } from './editor'
import { deserializeBlueprint } from './editor'
import { EventScheduler, FactoryRuntimeInstance } from './simulation'
import { createBoundaryNode, createDemoBlueprint, createMachineNode } from './ui/demo-blueprint'
import { FactoryGraphEditor, type GraphSelection } from './ui/FactoryGraphEditor'
import { WorldView } from './ui/WorldView'
import { CompilationClient } from './workers'

const idFactory = createIdFactory(100)
const compiler = new CompilationClient()
const stateTone: Record<string, string> = { RUNNING: 'good', WAITING_INPUT: 'waiting', OUTPUT_BLOCKED: 'blocked', PAUSED: 'muted', INVALID: 'bad', MAINTENANCE: 'bad' }

const App = () => {
  const [history] = useState(() => new BlueprintHistory(createDemoBlueprint()))
  const [blueprint, setBlueprint] = useState<FactoryBlueprint>(() => history.current)
  const [compilationBlueprint, setCompilationBlueprint] = useState<FactoryBlueprint>(() => history.current)
  const [contract, setContract] = useState<FactoryContract>()
  const [diagnostics, setDiagnostics] = useState<readonly CompileDiagnostic[]>([])
  const [compileState, setCompileState] = useState<'compiling' | 'ready' | 'invalid'>('compiling')
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(true)
  const [view, setView] = useState<'factory' | 'world'>('factory')
  const [selection, setSelection] = useState<GraphSelection>({ nodeIds: [], edgeIds: [] })
  const [catalogueQuery, setCatalogueQuery] = useState('')
  const [boundaryResource, setBoundaryResource] = useState<ResourceId>(() => resources[0]!.id)
  const [logicalTime, setLogicalTime] = useState(0n)
  const [, renderRuntime] = useState(0)
  const mounted = useRef(true)
  const displayedCompilation = useRef(0)
  const runtime = useMemo(() => {
    if (contract === undefined) return undefined
    const instance = new FactoryRuntimeInstance(asId('instance-main'), contract, 24)
    const scheduler = new EventScheduler(); scheduler.register(instance)
    return { instance, scheduler }
  }, [contract])
  const instance = runtime?.instance
  const scheduler = runtime?.scheduler

  const execute = useCallback((command: EditCommand) => { const next = history.execute(command); if (command.affectsCompilation) { setDiagnostics([]); setCompileState('compiling'); setCompilationBlueprint(next) } setBlueprint(next) }, [history])
  const undo = useCallback(() => { const next = history.undo(); if (next.revision !== blueprint.revision) { setDiagnostics([]); setCompileState('compiling'); setCompilationBlueprint(next) } setBlueprint(next) }, [blueprint.revision, history])
  const redo = useCallback(() => { const next = history.redo(); if (next.revision !== blueprint.revision) { setDiagnostics([]); setCompileState('compiling'); setCompilationBlueprint(next) } setBlueprint(next) }, [blueprint.revision, history])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    void import('./persistence').then(async ({ database }) => database.blueprints.get('factory-main')).then((record) => {
        if (!active || record === undefined || record.schemaVersion !== 4) return
        try { const restored = history.replace(deserializeBlueprint(JSON.parse(record.payload))); setCompileState('compiling'); setBlueprint(restored); setCompilationBlueprint(restored) }
        catch (error) { console.error('Saved blueprint could not be loaded; the recovery record was preserved.', error) }
      })
    return () => { active = false }
  }, [history])
  useEffect(() => {
    void compiler.compile(compilationBlueprint).then((result) => {
      if (!mounted.current || result.generation < displayedCompilation.current) return
      if (result.stale && result.contract === undefined) return
      displayedCompilation.current = result.generation
      setDiagnostics(result.diagnostics)
      if (result.contract === undefined) { setContract(undefined); setCompileState('invalid'); return }
      setContract(result.contract); setLogicalTime(0n); setCompileState(result.stale ? 'compiling' : 'ready')
    })
  }, [compilationBlueprint])
  useEffect(() => {
    if (instance === undefined) return undefined
    return instance.subscribe(() => renderRuntime((value) => value + 1))
  }, [instance])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if (event.key.toLowerCase() === 'd' && selection.nodeIds.length > 0) { event.preventDefault(); execute(duplicateNodes(blueprint, selection.nodeIds, idFactory)) }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [blueprint, execute, redo, selection.nodeIds, undo])

  const addMachine = (recipeId: RecipeId) => {
    const id = idFactory.next('NodeId')
    execute(addNode(createMachineNode(id, recipeId, 7 + blueprint.nodes.size, 9 + (blueprint.nodes.size % 3) * 4)))
  }
  const addBoundary = (kind: 'external-input' | 'external-output') => {
    const id = idFactory.next('NodeId'); const portId = idFactory.next('PortId'); const isInput = kind === 'external-input'
    const node = createBoundaryNode(id, portId, kind, boundaryResource, isInput ? 1 : 18, 8 + blueprint.nodes.size * 2)
    execute(transaction(isInput ? 'Add resource intake' : 'Add resource dispatch', [addNode(node), addExternalPort({ nodeId: id, portId, side: isInput ? 'left' : 'right', offset: 1 })]))
  }
  const addJunction = () => {
    const id = idFactory.next('NodeId'); execute(addNode(createJunctionNode(id, gridPoint(10, 10))))
  }
  const supplyInputs = () => {
    if (instance === undefined) return
    for (const [resource, buffer] of instance.inputs) if (buffer.freeSpace > 0) instance.addInput(resource, Math.min(12, buffer.freeSpace), logicalTime)
    scheduler?.schedule(instance)
  }
  const advance = (seconds: number) => {
    if (instance === undefined) return
    const target = logicalTime + FactoryRuntimeInstance.seconds(seconds); scheduler?.schedule(instance); scheduler?.advanceTo(target); setLogicalTime(target); renderRuntime((value) => value + 1)
  }
  const collectOutputs = () => {
    if (instance === undefined) return
    for (const [resource, buffer] of instance.outputs) if (buffer.quantity > 0) instance.removeOutput(resource, buffer.quantity, logicalTime)
    scheduler?.schedule(instance)
  }
  const deleteSelection = () => {
    if (selection.nodeIds.length === 0 && selection.edgeIds.length === 0) return
    const selectedNodes = new Set(selection.nodeIds)
    const independentEdges = selection.edgeIds.filter((id) => {
      const edge = blueprint.edges.get(id)
      return edge !== undefined && !selectedNodes.has(edge.sourceNodeId) && !selectedNodes.has(edge.targetNodeId)
    })
    execute(transaction('Delete selection', [
      ...selection.nodeIds.map(removeNode),
      ...independentEdges.map(disconnectEdge),
    ]))
    setSelection({ nodeIds: [], edgeIds: [] })
  }
  const selectedNode = selection.nodeIds.length === 1 ? blueprint.nodes.get(selection.nodeIds[0]!) : undefined
  const selectedEdge = selection.edgeIds.length === 1 && selection.nodeIds.length === 0 ? blueprint.edges.get(selection.edgeIds[0]!) : undefined
  const selectedSections = selectedEdge === undefined ? [] : routeSections(blueprint, selectedEdge)
  const selectedEdgeLength = selectedEdge === undefined ? undefined : routePhysicalLength(blueprint, selectedEdge)
  const selectedEdgeLengthText = selectedEdgeLength?.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const selectionCount = selection.nodeIds.length + selection.edgeIds.length
  const issueCount = diagnostics.length
  const snapshot = instance?.getSnapshot()
  const rates = useMemo(() => ({ inputs: [...(contract?.inputRates ?? [])], outputs: [...(contract?.outputRates ?? [])] }), [contract])
  const filteredRecipes = useMemo(() => {
    const query = catalogueQuery.trim().toLocaleLowerCase()
    if (query.length === 0) return recipes
    return recipes.filter((recipe) => `${recipe.name} ${recipe.inputs.map((input) => resourceById.get(input.resourceId)?.name ?? '').join(' ')}`.toLocaleLowerCase().includes(query))
  }, [catalogueQuery])

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">F</span><div><strong>Factory Game</strong><small>Graph engineering console</small></div></div>
      <div className="factory-title"><span>{view === 'factory' ? 'Blueprint /' : 'World /'}</span><strong>{view === 'factory' ? blueprint.name : 'Production network'}</strong><em>{view === 'factory' ? `rev ${blueprint.revision}` : '1 active site'}</em></div>
      <div className="top-status"><span className={`status-dot ${compileState}`} />{compileState === 'ready' ? 'Contract ready' : compileState === 'compiling' ? 'Compiling…' : 'Invalid graph'}<button className="icon-button" title="Save game" aria-label="Save game" onClick={() => { if (contract !== undefined) void import('./persistence').then(({ saveGame }) => saveGame([blueprint], [contract], instance === undefined ? [] : [instance], logicalTime)) }}>⌁</button></div>
    </header>
    <section className="toolbar" aria-label="Editor tools">
      <div className="view-switch" aria-label="View"><button aria-label="World" aria-pressed={view === 'world'} className={view === 'world' ? 'active' : ''} onClick={() => setView('world')}>◎ <span>World</span></button><button aria-label="Factory" aria-pressed={view === 'factory'} className={view === 'factory' ? 'active' : ''} onClick={() => setView('factory')}>◇ <span>Factory</span></button></div>
      {view === 'factory' && <><div className="tool-group"><button onClick={undo} disabled={!history.canUndo} aria-label="Undo" title="Ctrl+Z">↶ <span>Undo</span></button><button onClick={redo} disabled={!history.canRedo} aria-label="Redo" title="Ctrl+Shift+Z">↷ <span>Redo</span></button></div>
      <div className="tool-group"><button onClick={addJunction}>◆ <span>Junction</span></button><button onClick={() => selection.nodeIds.length > 0 && execute(duplicateNodes(blueprint, selection.nodeIds, idFactory))} disabled={selection.nodeIds.length === 0} title="Ctrl+D">⧉ <span>Duplicate</span></button><button className="delete-tool" onClick={deleteSelection} disabled={selectionCount === 0} title="Delete / Backspace">⌫ <span>Delete{selectionCount > 0 ? ` (${selectionCount})` : ''}</span></button></div></>}
      <div className="tool-spacer" />
      {view === 'factory' && <><button className={diagnosticsVisible ? 'active' : ''} onClick={() => setDiagnosticsVisible((value) => !value)}>◉ <span>Flow diagnostics</span></button>
      <div className={`issue-pill ${issueCount > 0 ? 'has-issues' : ''}`}>{issueCount} {issueCount === 1 ? 'notice' : 'notices'}</div></>}
    </section>
    {view === 'factory' ? <div className="workspace">
      <aside className="catalogue panel">
        <div className="panel-heading"><div><span className="eyebrow">Build</span><h2>Machine catalogue</h2></div><span>{recipes.length}</span></div>
        <label className="search"><span>⌕</span><input aria-label="Search machines" placeholder="Search machines" value={catalogueQuery} onChange={(event) => setCatalogueQuery(event.target.value)} /></label>
        <div className="catalogue-list">
          {filteredRecipes.map((recipe) => <button className="catalogue-item" key={recipe.id} onClick={() => addMachine(recipe.id)}>
            <span className="machine-glyph">⬡</span><span><strong>{recipe.name}</strong><small>{recipe.inputs.length === 0 ? 'Resource source' : recipe.inputs.map((input) => resourceById.get(input.resourceId)?.name).join(' + ')}</small></span><b>＋</b>
          </button>)}
          {filteredRecipes.length === 0 && <p className="catalogue-empty">No machines match “{catalogueQuery}”.</p>}
        </div>
        <div className="boundary-builder"><span className="eyebrow">Factory boundary</span><select aria-label="Boundary resource" value={boundaryResource} onChange={(event) => setBoundaryResource(asId<ResourceId>(event.target.value))}>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select><div><button onClick={() => addBoundary('external-input')}>→ Intake</button><button onClick={() => addBoundary('external-output')}>← Dispatch</button></div></div>
        <div className="resource-key"><span className="eyebrow">Resource key</span>{resources.map((resource) => <div key={resource.id}><i style={{ background: resource.colour }} />{resource.name}</div>)}</div>
      </aside>
      <section className="canvas-stack">
        <div className="canvas-caption"><span>Factory interior</span><small>Grid unit: 1 m · shortest path has priority</small></div>
        <FactoryGraphEditor blueprint={blueprint} contract={contract} diagnostics={diagnostics} diagnosticsVisible={diagnosticsVisible} onCommand={execute} onSelection={setSelection} />
        <div className="canvas-legend">{diagnostics.some((item) => item.severity === 'error') ? <><span><i className="line problem" /> Problem route</span><span><i className="line blocked" /> Blocked by graph error</span></> : <><span><i className="line active" /> Active flow</span><span><i className="line saturated" /> Saturated</span><span><i className="line idle" /> Available route</span></>}</div>
      </section>
      <aside className="inspector panel">
        <div className="panel-heading"><div><span className="eyebrow">Inspect</span><h2>{selectedNode?.name ?? (selectedEdge === undefined ? 'Factory contract' : 'Selected route')}</h2></div><span>⌘</span></div>
        {selectedNode !== undefined && <section className="inspector-card"><h3>Selected node</h3><dl><div><dt>Type</dt><dd>{selectedNode.kind}</dd></div><div><dt>Grid position</dt><dd>{selectedNode.position.x}, {selectedNode.position.y}</dd></div><div><dt>Ports</dt><dd>{selectedNode.ports.length}</dd></div></dl><button className="danger-button" onClick={deleteSelection}>Delete node</button></section>}
        {selectedEdge !== undefined && <section className="inspector-card"><h3>Selected route</h3><dl><div><dt>Resource</dt><dd>{resourceById.get(routeResource(blueprint, selectedEdge)!)?.name ?? 'Any'}</dd></div><div><dt>Current / capacity</dt><dd>{formatRate(contract?.edgeFlows.get(selectedEdge.id) ?? 0n)} / {formatRate(routeCapacity(blueprint, selectedEdge))}/s</dd></div><div><dt>Physical length</dt><dd>{selectedEdgeLengthText} m</dd></div><div><dt>Handles</dt><dd>{selectedEdge.routeHandles.length}</dd></div><div><dt>Layers</dt><dd>{[...new Set(selectedSections.map((section) => section.layerId))].join(' + ') || 'primary'}</dd></div><div><dt>Bridges</dt><dd>{selectedEdge.bridges.length}</dd></div><div><dt>Priority</dt><dd>length → grid → ID</dd></div></dl><button className="danger-button" onClick={deleteSelection}>Delete route</button></section>}
        <section className="inspector-card contract-card"><h3>Net programme <span className="badge">Coupled</span></h3><div className="rates"><div><span>Inputs</span>{rates.inputs.map(([id, rate]) => <p key={id}><i style={{ background: resourceById.get(id)?.colour }} />{resourceById.get(id)?.name}<b>{formatRate(rate)}/s</b></p>)}</div><div><span>Outputs</span>{rates.outputs.map(([id, rate]) => <p key={id}><i style={{ background: resourceById.get(id)?.colour }} />{resourceById.get(id)?.name}<b>{formatRate(rate)}/s</b></p>)}</div></div>{contract !== undefined && <small>Footprint {contract.footprint.width} × {contract.footprint.height} m · {contract.blueprintHash.slice(0, 10)}</small>}</section>
        <section className="inspector-card runtime-card"><h3>World runtime {instance !== undefined && <span className={`badge ${stateTone[instance.state]}`}>{instance.state.replace('_', ' ')}</span>}</h3>
          <div className="runtime-actions"><button onClick={supplyInputs}>Supply +12</button><button onClick={() => advance(5)}>Run 5 s</button><button onClick={collectOutputs}>Collect</button></div>
          <small>Logical time {Number(logicalTime) / 1_000_000}s · {scheduler?.scheduledEvents ?? 0} scheduled · {scheduler?.sleepingActors ?? 0} sleeping</small>
          {snapshot?.inputs.map((buffer) => <div className="buffer" key={`in-${buffer.resourceId}`}><span>{resourceById.get(buffer.resourceId)?.name} input</span><b>{buffer.quantity}/{buffer.capacity}</b><div><i style={{ width: `${buffer.quantity / buffer.capacity * 100}%` }} /></div></div>)}
          {snapshot?.outputs.map((buffer) => <div className="buffer output" key={`out-${buffer.resourceId}`}><span>{resourceById.get(buffer.resourceId)?.name} output</span><b>{buffer.quantity}/{buffer.capacity}</b><div><i style={{ width: `${buffer.quantity / buffer.capacity * 100}%` }} /></div></div>)}
        </section>
        <section className="inspector-card diagnostics"><h3>Diagnostics</h3>{compileState === 'ready' && diagnostics.length === 0 && <p className="diagnostic-ok">✓ Exact conservation verified</p>}{diagnostics.map((item, index) => <p key={`${item.code}-${index}`}><span>!</span>{diagnosticText(item)}</p>)}{compileState === 'invalid' && <p><span>!</span>The highlighted routes must be repaired before the graph can compile.</p>}</section>
      </aside>
    </div> : <WorldView blueprint={blueprint} contract={contract} compileState={compileState} snapshot={snapshot} logicalTime={logicalTime} scheduledEvents={scheduler?.scheduledEvents ?? 0} sleepingActors={scheduler?.sleepingActors ?? 0} onOpenFactory={() => setView('factory')} onSupply={supplyInputs} onAdvance={() => advance(5)} onCollect={collectOutputs} />}
  </main>
}

export default App
