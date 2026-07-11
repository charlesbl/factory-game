import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  asId,
  createIdFactory,
  formatRate,
  gridPoint,
  recipes,
  resourceById,
  resources,
} from './domain';
import type { FactoryId, NodeId, PortId, RecipeId, ResourceId } from './domain';
import type { CompileDiagnostic, FactoryContract } from './compiler';
import { diagnosticText, hydrateBoundaryPortRates } from './compiler';
import type { FactoryBlueprint, GraphClipboardPayload } from './editor';
import {
  BlueprintHistory,
  captureSubgraph,
  createBlueprint,
  createClipboardPayload,
  createJunctionNode,
  disconnectEdge,
  insertSubgraph,
  materializeSubgraph,
  removeLooseConnection,
  removeNode,
  replaceSubFactoryVersion,
  routeCapacity,
  routePhysicalLength,
  routeResource,
  routeSections,
  subgraphSelection,
  transaction,
  translateSubgraph,
  type EditCommand,
} from './editor';
import {
  createFactoryDefinition,
  deleteFactoryDefinition,
  deleteFactoryDraft,
  deleteFactoryVersion,
  latestVersion,
  loadFactoryLibrary,
  materializeSubFactoryNode,
  publishFactoryVersion,
  renameFactoryDefinition,
  restoreFactoryVersionAsDraft,
  saveFactoryDraft,
  versionsByKey,
  versionKey,
  wouldCreateIdentityCycle,
  type FactoryDefinition,
  type FactoryDraft,
  type FactoryVersion,
} from './factories';
import {
  createBoundaryNode,
  createDemoBlueprint,
  createMachineNode,
} from './ui/demo-blueprint';
import {
  FactoryGraphEditor,
  type GraphPlacement,
  type GraphSelection,
} from './ui/FactoryGraphEditor';
import { FactoryLibraryView } from './ui/FactoryLibraryView';
import { WorldView } from './ui/WorldView';
import { CompilationClient } from './workers';

const idFactory = createIdFactory(100);
const compiler = new CompilationClient();
const INITIAL_FACTORY_NAME = 'Starter iron line';
const LAST_OPENED_FACTORY_KEY = 'factory-game:last-opened-factory';
const LIBRARY_INITIALIZED_KEY = 'factory-game:library-initialized';
interface PendingPlacement extends GraphPlacement {
  readonly payload: GraphClipboardPayload;
}
const emptySelection = (): GraphSelection => ({
  nodeIds: [],
  edgeIds: [],
  looseConnectionIds: [],
});
const isTextEditing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const App = () => {
  const initialBlueprint = useMemo(() => createDemoBlueprint(), []);
  const [history] = useState(() => new BlueprintHistory(createDemoBlueprint()));
  const [blueprint, setBlueprint] = useState<FactoryBlueprint>(
    () => history.current,
  );
  const [compilationBlueprint, setCompilationBlueprint] =
    useState<FactoryBlueprint>(() => history.current);
  const [contract, setContract] = useState<FactoryContract>();
  const [diagnostics, setDiagnostics] = useState<readonly CompileDiagnostic[]>(
    [],
  );
  const [compileState, setCompileState] = useState<
    'compiling' | 'ready' | 'invalid'
  >('compiling');
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(true);
  const [view, setView] = useState<'factory' | 'world' | 'library'>('factory');
  const [definitions, setDefinitions] = useState<readonly FactoryDefinition[]>(
    () => [
      {
        id: initialBlueprint.id,
        name: INITIAL_FACTORY_NAME,
        nextVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  );
  const [drafts, setDrafts] = useState<readonly FactoryDraft[]>([]);
  const [versions, setVersions] = useState<readonly FactoryVersion[]>([]);
  const [activeFactoryId, setActiveFactoryId] = useState<FactoryId>(
    initialBlueprint.id,
  );
  const [libraryReady, setLibraryReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>(
    'saved',
  );
  const [libraryError, setLibraryError] = useState<string>();
  const [selection, setSelection] = useState<GraphSelection>(emptySelection);
  const [clipboard, setClipboard] = useState<GraphClipboardPayload>();
  const [placement, setPlacement] = useState<PendingPlacement>();
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [boundaryResource, setBoundaryResource] = useState<ResourceId>(
    () => resources[0]!.id,
  );
  const mounted = useRef(true);
  const displayedCompilation = useRef(0);
  const activeDefinition =
    definitions.find((definition) => definition.id === activeFactoryId) ??
    definitions[0];
  const versionIndex = useMemo(() => versionsByKey(versions), [versions]);
  const childContracts = useMemo(
    () =>
      new Map(
        versions.map((version) => [
          version.contract.blueprintHash,
          version.recovered
            ? version.contract
            : hydrateBoundaryPortRates(version.blueprint, version.contract),
        ]),
      ),
    [versions],
  );
  const activeBaseVersion = drafts.find(
    (draft) => draft.factoryId === activeFactoryId,
  )?.baseVersion;

  const execute = useCallback(
    (command: EditCommand) => {
      const next = history.execute(command);
      if (command.affectsCompilation) {
        setDiagnostics([]);
        setCompileState('compiling');
        setCompilationBlueprint(next);
      }
      setSaveStatus('saving');
      setBlueprint(next);
    },
    [history],
  );
  const undo = useCallback(() => {
    setPlacement(undefined);
    const next = history.undo();
    if (next.revision !== blueprint.revision) {
      setDiagnostics([]);
      setCompileState('compiling');
      setCompilationBlueprint(next);
    }
    setSaveStatus('saving');
    setBlueprint(next);
  }, [blueprint.revision, history]);
  const redo = useCallback(() => {
    setPlacement(undefined);
    const next = history.redo();
    if (next.revision !== blueprint.revision) {
      setDiagnostics([]);
      setCompileState('compiling');
      setCompilationBlueprint(next);
    }
    setSaveStatus('saving');
    setBlueprint(next);
  }, [blueprint.revision, history]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void loadFactoryLibrary()
      .then(async (snapshot) => {
        if (!active) return;
        if (snapshot.definitions.length === 0) {
          if (localStorage.getItem(LIBRARY_INITIALIZED_KEY) === 'true') {
            localStorage.removeItem(LAST_OPENED_FACTORY_KEY);
            setDefinitions([]);
            setDrafts([]);
            setVersions([]);
            setView('library');
            setLibraryReady(true);
            return;
          }
          const definition = await createFactoryDefinition(
            initialBlueprint,
            INITIAL_FACTORY_NAME,
          );
          if (!active) return;
          localStorage.setItem(LIBRARY_INITIALIZED_KEY, 'true');
          localStorage.setItem(LAST_OPENED_FACTORY_KEY, definition.id);
          setDefinitions([definition]);
          setDrafts([
            {
              factoryId: definition.id,
              blueprint: initialBlueprint,
              autosavedAt: definition.updatedAt,
            },
          ]);
          setLibraryReady(true);
          return;
        }
        const lastOpenedFactoryId = localStorage.getItem(
          LAST_OPENED_FACTORY_KEY,
        );
        localStorage.setItem(LIBRARY_INITIALIZED_KEY, 'true');
        const definition =
          snapshot.definitions.find(
            (item) => item.id === lastOpenedFactoryId,
          ) ??
          snapshot.definitions.find(
            (item) => item.id === initialBlueprint.id,
          ) ??
          snapshot.definitions[0]!;
        localStorage.setItem(LAST_OPENED_FACTORY_KEY, definition.id);
        let draft = snapshot.drafts.find(
          (item) => item.factoryId === definition.id,
        );
        if (draft === undefined) {
          const published = latestVersion(definition.id, snapshot.versions);
          draft =
            published === undefined
              ? await saveFactoryDraft(
                  definition.id,
                  createBlueprint(definition.id),
                )
              : await restoreFactoryVersionAsDraft(published);
        }
        if (!active) return;
        const restored = history.replace(draft.blueprint);
        setDefinitions(snapshot.definitions);
        setDrafts([
          ...snapshot.drafts.filter((item) => item.factoryId !== definition.id),
          draft,
        ]);
        setVersions(snapshot.versions);
        setActiveFactoryId(definition.id);
        setBlueprint(restored);
        setCompilationBlueprint(restored);
        setCompileState('compiling');
        setLibraryReady(true);
      })
      .catch((error: unknown) => {
        console.error('Factory library could not be loaded.', error);
        setLibraryError(
          error instanceof Error ? error.message : 'Library load failed',
        );
        setLibraryReady(true);
      });
    return () => {
      active = false;
    };
  }, [history, initialBlueprint]);
  useEffect(() => {
    void compiler
      .compile(compilationBlueprint, childContracts)
      .then((result) => {
        if (
          !mounted.current ||
          result.generation < displayedCompilation.current
        )
          return;
        if (result.stale && result.contract === undefined) return;
        displayedCompilation.current = result.generation;
        setDiagnostics(result.diagnostics);
        if (result.contract === undefined) {
          setContract(undefined);
          setCompileState('invalid');
          return;
        }
        setContract(result.contract);
        setCompileState(result.stale ? 'compiling' : 'ready');
      });
  }, [childContracts, compilationBlueprint]);
  useEffect(() => {
    if (!libraryReady || view !== 'factory') return undefined;
    const timeout = window.setTimeout(() => {
      void saveFactoryDraft(activeFactoryId, blueprint, activeBaseVersion)
        .then((draft) => {
          if (!mounted.current) return;
          setDrafts((current) => [
            ...current.filter((item) => item.factoryId !== activeFactoryId),
            draft,
          ]);
          setSaveStatus('saved');
        })
        .catch((error: unknown) => {
          console.error('Draft autosave failed.', error);
          setSaveStatus('error');
        });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [activeBaseVersion, activeFactoryId, blueprint, libraryReady, view]);
  useEffect(() => {
    const flushWhenHidden = () => {
      if (
        document.visibilityState === 'hidden' &&
        libraryReady &&
        view === 'factory'
      )
        void saveFactoryDraft(activeFactoryId, blueprint, activeBaseVersion);
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () =>
      document.removeEventListener('visibilitychange', flushWhenHidden);
  }, [activeBaseVersion, activeFactoryId, blueprint, libraryReady, view]);
  const openFactory = async (
    factoryId: FactoryId,
    nextView: 'factory' | 'world' = 'factory',
  ) => {
    setPlacement(undefined);
    try {
      const definition = definitions.find((item) => item.id === factoryId);
      if (definition === undefined) return;
      const storedDraft = drafts.find((item) => item.factoryId === factoryId);
      if (factoryId === activeFactoryId && storedDraft !== undefined) {
        localStorage.setItem(LAST_OPENED_FACTORY_KEY, factoryId);
        setView(nextView);
        return;
      }
      if (factoryId !== activeFactoryId) {
        const currentDraft = drafts.find(
          (item) => item.factoryId === activeFactoryId,
        );
        if (currentDraft !== undefined) {
          const savedCurrent = await saveFactoryDraft(
            activeFactoryId,
            blueprint,
            currentDraft.baseVersion,
          );
          setDrafts((current) => [
            ...current.filter((item) => item.factoryId !== activeFactoryId),
            savedCurrent,
          ]);
        }
      }
      const published = latestVersion(factoryId, versions);
      const draft =
        storedDraft ??
        (published === undefined
          ? await saveFactoryDraft(factoryId, createBlueprint(factoryId))
          : await restoreFactoryVersionAsDraft(published));
      if (storedDraft === undefined)
        setDrafts((current) => [
          ...current.filter((item) => item.factoryId !== factoryId),
          draft,
        ]);
      const next = history.replace(draft.blueprint);
      localStorage.setItem(LAST_OPENED_FACTORY_KEY, factoryId);
      setActiveFactoryId(factoryId);
      setBlueprint(next);
      setCompilationBlueprint(next);
      setContract(undefined);
      setDiagnostics([]);
      setSelection(emptySelection());
      setCompileState('compiling');
      setView(nextView);
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not open factory',
      );
    }
  };
  const createFactory = async (name: string) => {
    setPlacement(undefined);
    try {
      const id = asId<FactoryId>(`factory-${crypto.randomUUID()}`);
      const empty = createBlueprint(id);
      const definition = await createFactoryDefinition(empty, name);
      const draft: FactoryDraft = {
        factoryId: id,
        blueprint: empty,
        autosavedAt: definition.updatedAt,
      };
      setDefinitions((current) =>
        [...current, definition].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setDrafts((current) => [...current, draft]);
      const next = history.replace(empty);
      localStorage.setItem(LAST_OPENED_FACTORY_KEY, id);
      setActiveFactoryId(id);
      setBlueprint(next);
      setCompilationBlueprint(next);
      setSelection(emptySelection());
      setCompileState('compiling');
      setView('factory');
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not create factory',
      );
    }
  };
  const renameFactory = async (factoryId: FactoryId, name: string) => {
    const definition = definitions.find((item) => item.id === factoryId);
    if (definition === undefined) return;
    try {
      const renamed = await renameFactoryDefinition(definition, name);
      setDefinitions((current) =>
        current
          .map((item) => (item.id === factoryId ? renamed : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not rename factory',
      );
    }
  };
  const cycleText = (
    path: readonly {
      readonly factoryId: FactoryId;
      readonly version: number;
    }[],
  ): string =>
    path
      .map(
        (ref) =>
          `${definitions.find((item) => item.id === ref.factoryId)?.name ?? ref.factoryId} v${ref.version}`,
      )
      .join(' → ');
  const publishFactory = async (factoryId: FactoryId) => {
    const definition = definitions.find((item) => item.id === factoryId);
    const storedDraft = drafts.find((item) => item.factoryId === factoryId);
    const draft =
      factoryId === activeFactoryId
        ? {
            factoryId,
            blueprint,
            ...(storedDraft?.baseVersion === undefined
              ? {}
              : { baseVersion: storedDraft.baseVersion }),
            autosavedAt: storedDraft?.autosavedAt ?? new Date().toISOString(),
          }
        : storedDraft;
    if (definition === undefined || draft === undefined) return;
    for (const node of draft.blueprint.nodes.values())
      if (node.kind === 'sub-factory') {
        const path = wouldCreateIdentityCycle(
          factoryId,
          { factoryId: node.factoryId, version: node.version },
          versionIndex,
        );
        if (path !== undefined) {
          setLibraryError(
            `Publication blocked: ${cycleText(path)} leads back to ${definition.name}.`,
          );
          return;
        }
      }
    try {
      let publishedContract =
        factoryId === activeFactoryId && compileState === 'ready'
          ? contract
          : undefined;
      if (publishedContract === undefined) {
        const publisher = new CompilationClient();
        const result = await publisher.compile(draft.blueprint, childContracts);
        publisher.dispose();
        publishedContract = result.contract;
        if (publishedContract === undefined)
          throw new Error(
            'The draft must compile without errors before it can be published',
          );
      }
      const published = await publishFactoryVersion(
        definition,
        draft,
        publishedContract,
      );
      setDefinitions((current) =>
        current.map((item) =>
          item.id === factoryId ? published.definition : item,
        ),
      );
      setVersions((current) => [...current, published.version]);
      setDrafts((current) =>
        current.map((item) =>
          item.factoryId === factoryId
            ? {
                ...draft,
                baseVersion: published.version.version,
                autosavedAt: published.version.publishedAt,
              }
            : item,
        ),
      );
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Publication failed',
      );
    }
  };
  const forkVersion = async (version: FactoryVersion, name: string) => {
    setPlacement(undefined);
    try {
      const id = asId<FactoryId>(`factory-${crypto.randomUUID()}`);
      const forkedBlueprint: FactoryBlueprint = {
        ...version.blueprint,
        id,
        revision: version.blueprint.revision + 1,
      };
      const definition = await createFactoryDefinition(forkedBlueprint, name);
      const draft: FactoryDraft = {
        factoryId: id,
        blueprint: forkedBlueprint,
        autosavedAt: definition.updatedAt,
      };
      setDefinitions((current) =>
        [...current, definition].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setDrafts((current) => [...current, draft]);
      const next = history.replace(forkedBlueprint);
      localStorage.setItem(LAST_OPENED_FACTORY_KEY, id);
      setActiveFactoryId(id);
      setBlueprint(next);
      setCompilationBlueprint(next);
      setSelection(emptySelection());
      setCompileState('compiling');
      setView('factory');
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not fork version',
      );
    }
  };
  const inspectFactoryDraft = async (
    draft: FactoryDraft,
  ): Promise<FactoryContract | undefined> => {
    if (
      draft.factoryId === activeFactoryId &&
      draft.blueprint.revision === blueprint.revision &&
      compileState === 'ready'
    )
      return contract;
    const inspector = new CompilationClient();
    try {
      return (await inspector.compile(draft.blueprint, childContracts))
        .contract;
    } finally {
      inspector.dispose();
    }
  };
  const revertDraft = async (factoryId: FactoryId) => {
    setPlacement(undefined);
    try {
      await deleteFactoryDraft(factoryId);
      setDrafts((current) =>
        current.filter((item) => item.factoryId !== factoryId),
      );
      if (factoryId === activeFactoryId) {
        const published = latestVersion(factoryId, versions);
        const next = history.replace(
          published?.blueprint ?? createBlueprint(factoryId),
        );
        setBlueprint(next);
        setCompilationBlueprint(next);
        setSelection(emptySelection());
        setCompileState('compiling');
      }
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not revert draft',
      );
    }
  };
  const removeFactory = async (factoryId: FactoryId) => {
    setPlacement(undefined);
    try {
      await deleteFactoryDefinition(factoryId);
      const remaining = definitions.filter((item) => item.id !== factoryId);
      if (factoryId === activeFactoryId) {
        const nextDefinition = remaining[0];
        if (nextDefinition === undefined) {
          localStorage.removeItem(LAST_OPENED_FACTORY_KEY);
          setContract(undefined);
          setDiagnostics([]);
          setView('library');
        } else {
          const nextDraft = drafts.find(
            (item) => item.factoryId === nextDefinition.id,
          );
          const nextPublished = latestVersion(nextDefinition.id, versions);
          const next = history.replace(
            nextDraft?.blueprint ??
              nextPublished?.blueprint ??
              createBlueprint(nextDefinition.id),
          );
          localStorage.setItem(LAST_OPENED_FACTORY_KEY, nextDefinition.id);
          setActiveFactoryId(nextDefinition.id);
          setBlueprint(next);
          setCompilationBlueprint(next);
          setSelection(emptySelection());
          setCompileState('compiling');
          setView('library');
        }
      }
      setDefinitions(remaining);
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Factory cannot be deleted',
      );
    }
  };
  const removeVersion = async (version: FactoryVersion) => {
    try {
      await deleteFactoryVersion(version.factoryId, version.version);
      setVersions((current) =>
        current.filter((item) => versionKey(item) !== versionKey(version)),
      );
      setLibraryError(undefined);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Version cannot be deleted',
      );
    }
  };

  const validatePlacement = (payload: GraphClipboardPayload): boolean => {
    for (const node of payload.nodes)
      if (node.kind === 'sub-factory') {
        const ref = { factoryId: node.factoryId, version: node.version };
        if (!versionIndex.has(versionKey(ref))) {
          setLibraryError(
            `Placement blocked: ${node.name} v${node.version} is no longer available.`,
          );
          return false;
        }
        const path = wouldCreateIdentityCycle(
          activeFactoryId,
          ref,
          versionIndex,
        );
        if (path !== undefined) {
          setLibraryError(
            `Placement blocked: ${node.name} v${node.version} would create a factory cycle through ${cycleText(path)}.`,
          );
          return false;
        }
      }
    return true;
  };
  const startPlacement = (
    payload: GraphClipboardPayload | undefined,
    label: string,
  ) => {
    if (payload === undefined || !validatePlacement(payload)) return;
    setSelection(emptySelection());
    setPlacement({
      label,
      payload,
      subgraph: materializeSubgraph(payload, gridPoint(0, 0), idFactory),
    });
    setLibraryError(undefined);
  };
  const addMachine = (recipeId: RecipeId) => {
    const node = createMachineNode(
      asId<NodeId>('placement-machine'),
      recipeId,
      0,
      0,
    );
    startPlacement(createClipboardPayload([node]), node.name);
  };
  const addBoundary = (kind: 'external-input' | 'external-output') => {
    const id = asId<NodeId>('placement-boundary');
    const portId = asId<PortId>('placement-boundary-port');
    const isInput = kind === 'external-input';
    const node = createBoundaryNode(id, portId, kind, boundaryResource, 0, 0);
    startPlacement(
      createClipboardPayload(
        [node],
        [],
        [{ nodeId: id, portId, side: isInput ? 'left' : 'right', offset: 1 }],
      ),
      node.name,
    );
  };
  const addJunction = () => {
    const node = createJunctionNode(
      asId<NodeId>('placement-junction'),
      gridPoint(0, 0),
    );
    startPlacement(createClipboardPayload([node]), node.name);
  };
  const factoryCycleReason = (version: FactoryVersion): string | undefined => {
    const path = wouldCreateIdentityCycle(
      activeFactoryId,
      version,
      versionIndex,
    );
    return path === undefined
      ? undefined
      : `Cannot add ${definitions.find((item) => item.id === version.factoryId)?.name ?? version.factoryId} v${version.version}: it already contains ${activeDefinition?.name ?? 'the current factory'} through ${cycleText(path)}.`;
  };
  const addPublishedFactory = (version: FactoryVersion) => {
    if (factoryCycleReason(version) !== undefined) return;
    const definition = definitions.find(
      (item) => item.id === version.factoryId,
    );
    if (definition === undefined) return;
    const node = materializeSubFactoryNode(
      asId<NodeId>('placement-sub-factory'),
      definition,
      version.version,
      version.contract,
      gridPoint(0, 0),
    );
    startPlacement(createClipboardPayload([node]), node.name);
  };
  const deleteSelection = () => {
    if (
      selection.nodeIds.length === 0 &&
      selection.edgeIds.length === 0 &&
      selection.looseConnectionIds.length === 0
    )
      return;
    const selectedNodes = new Set(selection.nodeIds);
    const independentEdges = selection.edgeIds.filter((id) => {
      const edge = blueprint.edges.get(id);
      return (
        edge !== undefined &&
        !selectedNodes.has(edge.sourceNodeId) &&
        !selectedNodes.has(edge.targetNodeId)
      );
    });
    const independentLooseConnections = selection.looseConnectionIds.filter(
      (id) => {
        const loose = blueprint.looseConnections.get(id);
        return loose !== undefined && !selectedNodes.has(loose.origin.nodeId);
      },
    );
    execute(
      transaction('Delete selection', [
        ...selection.nodeIds.map(removeNode),
        ...independentEdges.map(disconnectEdge),
        ...independentLooseConnections.map(removeLooseConnection),
      ]),
    );
    setSelection(emptySelection());
  };
  const copySelection = () => {
    const payload = captureSubgraph(
      blueprint,
      selection.nodeIds,
      selection.looseConnectionIds,
    );
    if (payload !== undefined) {
      setClipboard(payload);
      setLibraryError(undefined);
    }
  };
  const cutSelection = () => {
    const payload = captureSubgraph(
      blueprint,
      selection.nodeIds,
      selection.looseConnectionIds,
    );
    if (payload === undefined) return;
    const selectedNodes = new Set(selection.nodeIds);
    const looseConnections = selection.looseConnectionIds.filter((id) => {
      const loose = blueprint.looseConnections.get(id);
      return loose !== undefined && !selectedNodes.has(loose.origin.nodeId);
    });
    setClipboard(payload);
    execute(
      transaction('Cut selection', [
        ...selection.nodeIds.map(removeNode),
        ...looseConnections.map(removeLooseConnection),
      ]),
    );
    setSelection(emptySelection());
    setPlacement(undefined);
    setLibraryError(undefined);
  };
  const pasteSelection = () => {
    if (clipboard !== undefined)
      startPlacement(
        clipboard,
        clipboard.nodes.length === 1
          ? clipboard.nodes[0]!.name
          : `${clipboard.nodes.length.toLocaleString()} components`,
      );
  };
  const duplicateSelection = () => {
    const payload = captureSubgraph(
      blueprint,
      selection.nodeIds,
      selection.looseConnectionIds,
    );
    if (payload !== undefined)
      startPlacement(
        payload,
        payload.nodes.length === 1
          ? payload.nodes[0]!.name
          : `${payload.nodes.length.toLocaleString()} components`,
      );
  };
  const commitPlacement = (
    position: ReturnType<typeof gridPoint>,
    repeat: boolean,
  ) => {
    if (placement === undefined) return;
    const placed = translateSubgraph(placement.subgraph, position);
    execute(
      insertSubgraph(
        placed,
        placement.payload.nodes.length === 1
          ? `Place ${placement.label}`
          : 'Paste selection',
      ),
    );
    if (repeat) {
      setSelection(emptySelection());
      setPlacement({
        ...placement,
        subgraph: materializeSubgraph(
          placement.payload,
          gridPoint(0, 0),
          idFactory,
        ),
      });
    } else {
      setSelection(subgraphSelection(placed));
      setPlacement(undefined);
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        view !== 'factory' ||
        activeDefinition === undefined ||
        isTextEditing(event.target)
      )
        return;
      const key = event.key.toLowerCase();
      const modified = event.ctrlKey || event.metaKey;
      if (modified && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (
        modified &&
        key === 'c' &&
        (selection.nodeIds.length > 0 ||
          selection.looseConnectionIds.length > 0)
      ) {
        event.preventDefault();
        copySelection();
        return;
      }
      if (
        modified &&
        key === 'x' &&
        (selection.nodeIds.length > 0 ||
          selection.looseConnectionIds.length > 0)
      ) {
        event.preventDefault();
        cutSelection();
        return;
      }
      if (modified && key === 'v' && clipboard !== undefined) {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if (
        modified &&
        key === 'd' &&
        (selection.nodeIds.length > 0 ||
          selection.looseConnectionIds.length > 0)
      ) {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (
        !modified &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        (selection.nodeIds.length > 0 ||
          selection.edgeIds.length > 0 ||
          selection.looseConnectionIds.length > 0)
      ) {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const selectedNode =
    selection.nodeIds.length === 1
      ? blueprint.nodes.get(selection.nodeIds[0]!)
      : undefined;
  const selectedSubFactoryVersions =
    selectedNode?.kind === 'sub-factory'
      ? versions
          .filter((version) => version.factoryId === selectedNode.factoryId)
          .sort((a, b) => b.version - a.version)
      : [];
  const selectedEdge =
    selection.edgeIds.length === 1 && selection.nodeIds.length === 0
      ? blueprint.edges.get(selection.edgeIds[0]!)
      : undefined;
  const selectedLooseConnection =
    selection.looseConnectionIds.length === 1 &&
    selection.nodeIds.length === 0 &&
    selection.edgeIds.length === 0
      ? blueprint.looseConnections.get(selection.looseConnectionIds[0]!)
      : undefined;
  const selectedSections =
    selectedEdge === undefined ? [] : routeSections(blueprint, selectedEdge);
  const selectedEdgeLength =
    selectedEdge === undefined
      ? undefined
      : routePhysicalLength(blueprint, selectedEdge);
  const selectedEdgeLengthText = selectedEdgeLength?.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  const selectionCount =
    selection.nodeIds.length +
    selection.edgeIds.length +
    selection.looseConnectionIds.length;
  const issueCount = diagnostics.length;
  const rates = useMemo(
    () => ({
      inputs: [...(contract?.inputRates ?? [])],
      outputs: [...(contract?.outputRates ?? [])],
    }),
    [contract],
  );
  const filteredRecipes = useMemo(() => {
    const query = catalogueQuery.trim().toLocaleLowerCase();
    if (query.length === 0) return recipes;
    return recipes.filter((recipe) =>
      `${recipe.name} ${recipe.inputs.map((input) => resourceById.get(input.resourceId)?.name ?? '').join(' ')}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [catalogueQuery]);
  const publishedFactories = useMemo(
    () =>
      definitions
        .flatMap((definition) => {
          const version = latestVersion(definition.id, versions);
          return version === undefined ? [] : [{ definition, version }];
        })
        .filter(({ definition }) =>
          definition.name
            .toLocaleLowerCase()
            .includes(catalogueQuery.trim().toLocaleLowerCase()),
        ),
    [catalogueQuery, definitions, versions],
  );
  const displayBlueprint = useMemo(
    () => ({
      ...blueprint,
      nodes: new Map(
        [...blueprint.nodes].map(([id, node]) => [
          id,
          node.kind === 'sub-factory'
            ? {
                ...node,
                name:
                  definitions.find((item) => item.id === node.factoryId)
                    ?.name ?? node.name,
              }
            : node,
        ]),
      ),
    }),
    [blueprint, definitions],
  );
  const changeSubFactoryVersion = (target: FactoryVersion) => {
    if (selectedNode?.kind !== 'sub-factory') return;
    const path = wouldCreateIdentityCycle(
      activeFactoryId,
      target,
      versionIndex,
    );
    if (path !== undefined) {
      setLibraryError(
        `Version change blocked: ${cycleText(path)} leads back to ${activeDefinition?.name ?? 'the current factory'}.`,
      );
      return;
    }
    const definition = definitions.find((item) => item.id === target.factoryId);
    if (definition === undefined) return;
    const replacement = materializeSubFactoryNode(
      selectedNode.id,
      definition,
      target.version,
      target.contract,
      selectedNode.position,
    );
    const oldKeys = new Set(
      selectedNode.ports.map(
        (port) => `${port.direction}:${port.resourceId}:${port.contractPortId}`,
      ),
    );
    const newKeys = new Set(
      replacement.ports.map(
        (port) => `${port.direction}:${port.resourceId}:${port.contractPortId}`,
      ),
    );
    const removed = [...oldKeys].filter((key) => !newKeys.has(key)).length;
    const added = [...newKeys].filter((key) => !oldKeys.has(key)).length;
    const affected = [...blueprint.edges.values()].filter(
      (edge) =>
        edge.sourceNodeId === selectedNode.id ||
        edge.targetNodeId === selectedNode.id,
    ).length;
    if (
      !window.confirm(
        `Switch from v${selectedNode.version} to v${target.version}?\nAdded ports: ${added}\nRemoved ports: ${removed}\nConnections to review: ${affected}\nIncompatible connections will become loose routes.`,
      )
    )
      return;
    const selectedId = selectedNode.id;
    execute(replaceSubFactoryVersion(selectedId, replacement));
    window.setTimeout(
      () =>
        setSelection({
          nodeIds: [selectedId],
          edgeIds: [],
          looseConnectionIds: [],
        }),
      0,
    );
    setLibraryError(undefined);
  };
  const changeView = async (next: 'factory' | 'world' | 'library') => {
    setPlacement(undefined);
    if (libraryReady && view === 'factory' && next !== 'factory') {
      try {
        const draft = await saveFactoryDraft(
          activeFactoryId,
          blueprint,
          activeBaseVersion,
        );
        setDrafts((current) => [
          ...current.filter((item) => item.factoryId !== activeFactoryId),
          draft,
        ]);
      } catch (error) {
        console.error('Draft save before navigation failed.', error);
        setSaveStatus('error');
        return;
      }
    }
    setView(next);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">F</span>
          <div>
            <strong>Factory Game</strong>
            <small>Graph engineering console</small>
          </div>
        </div>
        <div className="factory-title">
          <span>
            {view === 'factory'
              ? 'Blueprint /'
              : view === 'world'
                ? 'World /'
                : 'Library /'}
          </span>
          <strong>
            {view === 'factory'
              ? (activeDefinition?.name ?? 'No factory')
              : view === 'world'
                ? 'Production network'
                : 'My factories'}
          </strong>
          <em>
            {view === 'factory'
              ? `rev ${blueprint.revision}`
              : view === 'world'
                ? '1 active site'
                : `${versions.length} versions`}
          </em>
        </div>
        <div className="top-status">
          {view === 'factory' && activeDefinition !== undefined && (
            <>
              <span className={`status-dot ${compileState}`} />
              {compileState === 'ready'
                ? 'Contract ready'
                : compileState === 'compiling'
                  ? 'Compiling…'
                  : 'Invalid graph'}
              <span className={`save-state ${saveStatus}`}>
                {saveStatus === 'saving'
                  ? 'Saving…'
                  : saveStatus === 'saved'
                    ? 'Draft saved'
                    : 'Save failed'}
              </span>
              <button
                className="button button--primary button--compact publish-button"
                disabled={compileState !== 'ready'}
                onClick={() => void publishFactory(activeFactoryId)}
              >
                Publish
              </button>
            </>
          )}
        </div>
      </header>
      <section className="toolbar" aria-label="Editor tools">
        <div className="view-switch" aria-label="View">
          <button
            aria-label="World"
            aria-pressed={view === 'world'}
            className={view === 'world' ? 'active' : ''}
            disabled={activeDefinition === undefined}
            onClick={() => changeView('world')}
          >
            ◎ <span>World</span>
          </button>
          <button
            aria-label="Factory"
            title={
              activeDefinition === undefined
                ? 'Create a factory first'
                : `Return to ${activeDefinition.name}`
            }
            aria-pressed={view === 'factory'}
            className={view === 'factory' ? 'active' : ''}
            disabled={activeDefinition === undefined}
            onClick={() => changeView('factory')}
          >
            ◇ <span>Factory</span>
          </button>
          <button
            aria-label="Library"
            aria-pressed={view === 'library'}
            className={view === 'library' ? 'active' : ''}
            onClick={() => changeView('library')}
          >
            ▤ <span>Library</span>
          </button>
        </div>
        {view === 'factory' && activeDefinition !== undefined && (
          <>
            <div className="tool-group">
              <button
                onClick={undo}
                disabled={!history.canUndo}
                aria-label="Undo"
                title="Ctrl+Z"
              >
                ↶ <span>Undo</span>
              </button>
              <button
                onClick={redo}
                disabled={!history.canRedo}
                aria-label="Redo"
                title="Ctrl+Shift+Z"
              >
                ↷ <span>Redo</span>
              </button>
            </div>
            <div className="tool-group">
              <button onClick={addJunction} aria-label="Place junction">
                ◆ <span>Junction</span>
              </button>
            </div>
            <div className="tool-group clipboard-tools">
              <button
                onClick={copySelection}
                disabled={
                  selection.nodeIds.length === 0 &&
                  selection.looseConnectionIds.length === 0
                }
                aria-label="Copy selection"
                title="Ctrl+C"
              >
                ⧉ <span>Copy</span>
              </button>
              <button
                onClick={cutSelection}
                disabled={
                  selection.nodeIds.length === 0 &&
                  selection.looseConnectionIds.length === 0
                }
                aria-label="Cut selection"
                title="Ctrl+X"
              >
                ✂ <span>Cut</span>
              </button>
              <button
                onClick={pasteSelection}
                disabled={clipboard === undefined}
                aria-label="Paste selection"
                title="Ctrl+V"
              >
                ▣ <span>Paste</span>
              </button>
              <button
                onClick={duplicateSelection}
                disabled={
                  selection.nodeIds.length === 0 &&
                  selection.looseConnectionIds.length === 0
                }
                aria-label="Duplicate selection"
                title="Ctrl+D"
              >
                ⧉ <span>Duplicate</span>
              </button>
              <button
                className="delete-tool"
                onClick={deleteSelection}
                disabled={selectionCount === 0}
                aria-label={
                  selectionCount === 0
                    ? 'Delete selection'
                    : `Delete (${selectionCount.toLocaleString()})`
                }
                title="Delete / Backspace"
              >
                ⌫{' '}
                <span>
                  Delete
                  {selectionCount > 0
                    ? ` (${selectionCount.toLocaleString()})`
                    : ''}
                </span>
              </button>
            </div>
          </>
        )}
        <div className="tool-spacer" />
        {libraryError !== undefined && (
          <div className="library-error" role="alert">
            {libraryError}
            <button
              aria-label="Dismiss library error"
              onClick={() => setLibraryError(undefined)}
            >
              ×
            </button>
          </div>
        )}
        {view === 'factory' && activeDefinition !== undefined && (
          <>
            <button
              className={diagnosticsVisible ? 'active' : ''}
              onClick={() => setDiagnosticsVisible((value) => !value)}
            >
              ◉ <span>Flow diagnostics</span>
            </button>
            <div className={`issue-pill ${issueCount > 0 ? 'has-issues' : ''}`}>
              {issueCount} {issueCount === 1 ? 'notice' : 'notices'}
            </div>
          </>
        )}
      </section>
      {view === 'factory' && activeDefinition !== undefined ? (
        <div className="workspace">
          <aside className="catalogue panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Build</span>
                <h2>Machine catalogue</h2>
              </div>
              <span>{recipes.length}</span>
            </div>
            <label className="search">
              <span>⌕</span>
              <input
                aria-label="Search machines"
                placeholder="Search machines"
                value={catalogueQuery}
                onChange={(event) => setCatalogueQuery(event.target.value)}
              />
            </label>
            <div className="catalogue-list">
              {filteredRecipes.map((recipe) => (
                <button
                  className="catalogue-item"
                  key={recipe.id}
                  onClick={() => addMachine(recipe.id)}
                >
                  <span className="machine-glyph">⬡</span>
                  <span>
                    <strong>{recipe.name}</strong>
                    <small>
                      {recipe.inputs.length === 0
                        ? 'Resource source'
                        : recipe.inputs
                            .map(
                              (input) =>
                                resourceById.get(input.resourceId)?.name,
                            )
                            .join(' + ')}
                    </small>
                  </span>
                  <b>＋</b>
                </button>
              ))}
              {publishedFactories.length > 0 && (
                <div className="catalogue-section-label">My factories</div>
              )}
              {publishedFactories.map(({ definition, version }) => {
                const reason = factoryCycleReason(version);
                return (
                  <button
                    className="catalogue-item factory-catalogue-item"
                    key={definition.id}
                    disabled={reason !== undefined}
                    title={reason}
                    aria-describedby={
                      reason === undefined
                        ? undefined
                        : `cycle-${definition.id}`
                    }
                    onClick={() => addPublishedFactory(version)}
                  >
                    <span className="machine-glyph">▣</span>
                    <span>
                      <strong>{definition.name}</strong>
                      <small>
                        {reason ?? `Published version v${version.version}`}
                      </small>
                    </span>
                    <b>＋</b>
                    {reason !== undefined && (
                      <span id={`cycle-${definition.id}`} className="sr-only">
                        {reason}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredRecipes.length === 0 &&
                publishedFactories.length === 0 && (
                  <p className="catalogue-empty">
                    No machines match “{catalogueQuery}”.
                  </p>
                )}
            </div>
            <div className="boundary-builder">
              <span className="eyebrow">Factory boundary</span>
              <select
                aria-label="Boundary resource"
                value={boundaryResource}
                onChange={(event) =>
                  setBoundaryResource(asId<ResourceId>(event.target.value))
                }
              >
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
              <div>
                <button onClick={() => addBoundary('external-input')}>
                  → Intake
                </button>
                <button onClick={() => addBoundary('external-output')}>
                  ← Dispatch
                </button>
              </div>
            </div>
            <div className="resource-key">
              <span className="eyebrow">Resource key</span>
              {resources.map((resource) => (
                <div key={resource.id}>
                  <i style={{ background: resource.colour }} />
                  {resource.name}
                </div>
              ))}
            </div>
          </aside>
          <section className="canvas-stack">
            <div className="canvas-caption">
              <span>Factory interior</span>
              <small>Grid unit: 1 m · shortest path has priority</small>
            </div>
            <FactoryGraphEditor
              blueprint={displayBlueprint}
              contract={contract}
              childContracts={childContracts}
              diagnostics={diagnostics}
              diagnosticsVisible={diagnosticsVisible}
              selection={selection}
              {...(placement === undefined ? {} : { placement })}
              onCommand={execute}
              onSelection={setSelection}
              onPlacementCommit={commitPlacement}
              onPlacementCancel={() => setPlacement(undefined)}
            />
            <div className="canvas-legend">
              {diagnostics.some((item) => item.severity === 'error') ? (
                <>
                  <span>
                    <i className="line problem" /> Problem route
                  </span>
                  <span>
                    <i className="line blocked" /> Blocked by graph error
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <i className="line active" /> Active flow
                  </span>
                  <span>
                    <i className="line saturated" /> Saturated
                  </span>
                  <span>
                    <i className="line idle" /> Available route
                  </span>
                </>
              )}
            </div>
          </section>
          <aside className="inspector panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Inspect</span>
                <h2>
                  {selectedNode?.kind === 'sub-factory'
                    ? (definitions.find(
                        (item) => item.id === selectedNode.factoryId,
                      )?.name ?? selectedNode.name)
                    : (selectedNode?.name ??
                      (selectedEdge !== undefined
                        ? 'Selected route'
                        : selectedLooseConnection !== undefined
                          ? 'Incomplete route'
                          : 'Factory contract'))}
                </h2>
              </div>
              <span>⌘</span>
            </div>
            {selectedNode !== undefined && (
              <section className="inspector-card">
                <h3>Selected node</h3>
                <dl>
                  <div>
                    <dt>Type</dt>
                    <dd>{selectedNode.kind}</dd>
                  </div>
                  <div>
                    <dt>Grid position</dt>
                    <dd>
                      {selectedNode.position.x}, {selectedNode.position.y}
                    </dd>
                  </div>
                  <div>
                    <dt>Ports</dt>
                    <dd>{selectedNode.ports.length}</dd>
                  </div>
                  {selectedNode.kind === 'sub-factory' && (
                    <>
                      <div>
                        <dt>Factory</dt>
                        <dd>
                          {definitions.find(
                            (item) => item.id === selectedNode.factoryId,
                          )?.name ?? selectedNode.factoryId}
                        </dd>
                      </div>
                      <div>
                        <dt>Pinned version</dt>
                        <dd>v{selectedNode.version}</dd>
                      </div>
                    </>
                  )}
                </dl>
                {selectedNode.kind === 'sub-factory' && (
                  <div className="version-switcher">
                    <button
                      className="button button--primary button--block"
                      onClick={() => void openFactory(selectedNode.factoryId)}
                    >
                      Edit factory
                    </button>
                    <label>
                      Change version
                      <select
                        aria-label="Sub-factory version"
                        value={selectedNode.version}
                        onChange={(event) => {
                          const target = selectedSubFactoryVersions.find(
                            (version) =>
                              version.version === Number(event.target.value),
                          );
                          if (target !== undefined)
                            changeSubFactoryVersion(target);
                        }}
                      >
                        {selectedSubFactoryVersions.map((version) => (
                          <option key={version.version} value={version.version}>
                            v{version.version}
                            {version.version ===
                            selectedSubFactoryVersions[0]?.version
                              ? ' · latest'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedSubFactoryVersions[0] !== undefined &&
                      selectedSubFactoryVersions[0].version >
                        selectedNode.version && (
                        <button
                          className="button button--primary button--block"
                          onClick={() =>
                            changeSubFactoryVersion(
                              selectedSubFactoryVersions[0]!,
                            )
                          }
                        >
                          Upgrade to v{selectedSubFactoryVersions[0].version}
                        </button>
                      )}
                  </div>
                )}
                <button className="danger-button" onClick={deleteSelection}>
                  Delete node
                </button>
              </section>
            )}
            {selectedEdge !== undefined && (
              <section className="inspector-card">
                <h3>Selected route</h3>
                <dl>
                  <div>
                    <dt>Resource</dt>
                    <dd>
                      {resourceById.get(routeResource(blueprint, selectedEdge)!)
                        ?.name ?? 'Any'}
                    </dd>
                  </div>
                  <div>
                    <dt>Current / capacity</dt>
                    <dd>
                      {formatRate(
                        contract?.edgeFlows.get(selectedEdge.id) ?? 0n,
                      )}{' '}
                      / {formatRate(routeCapacity(blueprint, selectedEdge))}/s
                    </dd>
                  </div>
                  <div>
                    <dt>Physical length</dt>
                    <dd>{selectedEdgeLengthText} m</dd>
                  </div>
                  <div>
                    <dt>Handles</dt>
                    <dd>{selectedEdge.routeHandles.length}</dd>
                  </div>
                  <div>
                    <dt>Layers</dt>
                    <dd>
                      {[
                        ...new Set(
                          selectedSections.map((section) => section.layerId),
                        ),
                      ].join(' + ') || 'primary'}
                    </dd>
                  </div>
                  <div>
                    <dt>Bridges</dt>
                    <dd>{selectedEdge.bridges.length}</dd>
                  </div>
                  <div>
                    <dt>Priority</dt>
                    <dd>length → grid → ID</dd>
                  </div>
                </dl>
                <button className="danger-button" onClick={deleteSelection}>
                  Delete route
                </button>
              </section>
            )}
            {selectedLooseConnection !== undefined && (
              <section className="inspector-card">
                <h3>Incomplete route</h3>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>Waiting for endpoint</dd>
                  </div>
                  <div>
                    <dt>Handles</dt>
                    <dd>{selectedLooseConnection.routeHandles.length}</dd>
                  </div>
                </dl>
                <button className="danger-button" onClick={deleteSelection}>
                  Delete route
                </button>
              </section>
            )}
            <section className="inspector-card contract-card">
              <h3>
                Net program <span className="badge">Coupled</span>
              </h3>
              <div className="rates">
                <div>
                  <span>Inputs</span>
                  {rates.inputs.map(([id, rate]) => (
                    <p key={id}>
                      <i style={{ background: resourceById.get(id)?.colour }} />
                      {resourceById.get(id)?.name}
                      <b>{formatRate(rate)}/s</b>
                    </p>
                  ))}
                </div>
                <div>
                  <span>Outputs</span>
                  {rates.outputs.map(([id, rate]) => (
                    <p key={id}>
                      <i style={{ background: resourceById.get(id)?.colour }} />
                      {resourceById.get(id)?.name}
                      <b>{formatRate(rate)}/s</b>
                    </p>
                  ))}
                </div>
              </div>
              {contract !== undefined && (
                <small>
                  Footprint {contract.footprint.width} ×{' '}
                  {contract.footprint.height} m ·{' '}
                  {contract.blueprintHash.slice(0, 10)}
                </small>
              )}
            </section>
            <section className="inspector-card runtime-card">
              <h3>World runtime</h3>
              <p>
                Placed factories are simulated exclusively by the world worker.
                Use the World view to connect station rules, pods, construction
                and time controls.
              </p>
            </section>
            <section className="inspector-card diagnostics">
              <h3>Diagnostics</h3>
              {compileState === 'ready' && diagnostics.length === 0 && (
                <p className="diagnostic-ok">✓ Exact conservation verified</p>
              )}
              {diagnostics.map((item, index) => (
                <p key={`${item.code}-${index}`}>
                  <span>!</span>
                  {diagnosticText(item)}
                </p>
              ))}
              {compileState === 'invalid' && (
                <p>
                  <span>!</span>The highlighted routes must be repaired before
                  the graph can compile.
                </p>
              )}
            </section>
          </aside>
        </div>
      ) : view === 'world' && activeDefinition !== undefined ? (
        <WorldView
          blueprint={blueprint}
          factories={definitions}
          activeFactoryId={activeFactoryId}
          factoryName={activeDefinition.name}
          contract={contract}
          compileState={compileState}
          onSelectFactory={(id) => void openFactory(id, 'world')}
          onOpenFactory={() => changeView('factory')}
        />
      ) : (
        <FactoryLibraryView
          definitions={definitions}
          drafts={drafts}
          versions={versions}
          activeFactoryId={activeFactoryId}
          onOpen={(id) => void openFactory(id)}
          onCreate={(name) => void createFactory(name)}
          onRename={(id, name) => void renameFactory(id, name)}
          onPublish={(id) => void publishFactory(id)}
          onInspectDraft={inspectFactoryDraft}
          onForkVersion={(version, name) => void forkVersion(version, name)}
          onRevertDraft={(id) => void revertDraft(id)}
          onDeleteFactory={(id) => void removeFactory(id)}
          onDeleteVersion={(version) => void removeVersion(version)}
        />
      )}
    </main>
  );
};

export default App;
