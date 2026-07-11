import { useMemo, useState } from 'react';
import type { FactoryContract } from '../compiler';
import { formatRate, resourceById } from '../domain';
import type { FactoryId, RateRaw, ResourceId } from '../domain';
import type { FactoryBlueprint } from '../editor';
import type {
  FactoryDefinition,
  FactoryDraft,
  FactoryVersion,
} from '../factories';
import { FactoryDependencyGraph } from './FactoryDependencyView';

interface Props {
  readonly definitions: readonly FactoryDefinition[];
  readonly drafts: readonly FactoryDraft[];
  readonly versions: readonly FactoryVersion[];
  readonly activeFactoryId: FactoryId;
  readonly onOpen: (factoryId: FactoryId) => void;
  readonly onCreate: (name: string) => void;
  readonly onRename: (factoryId: FactoryId, name: string) => void;
  readonly onPublish: (factoryId: FactoryId) => void;
  readonly onInspectDraft: (
    draft: FactoryDraft,
  ) => Promise<FactoryContract | undefined>;
  readonly onForkVersion: (version: FactoryVersion, name: string) => void;
  readonly onRevertDraft: (factoryId: FactoryId) => void;
  readonly onDeleteFactory: (factoryId: FactoryId) => void;
  readonly onDeleteVersion: (version: FactoryVersion) => void;
}

const FlowPorts = ({
  direction,
  rates,
}: {
  readonly direction: 'input' | 'output';
  readonly rates: ReadonlyMap<ResourceId, RateRaw>;
}) => (
  <div className={`version-flow-lane version-flow-lane--${direction}`}>
    <span className="version-flow-lane__title">
      {direction === 'input' ? 'Inputs' : 'Outputs'} <b>{rates.size}</b>
    </span>
    {[...rates].map(([resourceId, rate]) => {
      const resource = resourceById.get(resourceId);
      return (
        <div
          className="version-flow-port"
          key={resourceId}
          style={{ color: resource?.colour }}
        >
          <i className="version-flow-connector" aria-hidden="true" />
          <span>
            <small>{resource?.name ?? resourceId}</small>
            <strong>{formatRate(rate)}/s</strong>
          </span>
        </div>
      );
    })}
    {rates.size === 0 && <span className="version-flow-empty">None</span>}
  </div>
);

const FactoryFlowSummary = ({
  name,
  subtitle,
  contract,
}: {
  readonly name: string;
  readonly subtitle: string;
  readonly contract: FactoryContract;
}) => (
  <section
    className="version-flow-summary"
    aria-label="Factory inputs and outputs"
  >
    <FlowPorts direction="input" rates={contract.inputRates} />
    <div className="version-flow-core">
      <span aria-hidden="true">▣</span>
      <strong>{name}</strong>
      <small>{subtitle}</small>
    </div>
    <FlowPorts direction="output" rates={contract.outputRates} />
  </section>
);

const ComponentCountSummary = ({
  blueprint,
}: {
  readonly blueprint: FactoryBlueprint;
}) => {
  const counts = new Map<string, number>();
  for (const node of blueprint.nodes.values())
    counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  const summary = [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} × ${count}`)
    .join(' · ');

  return (
    <section
      className="inspection-component-summary"
      aria-label="Components by type"
    >
      <h4>Components by type</h4>
      <p>{summary || 'Empty factory'}</p>
    </section>
  );
};

interface DraftInspection {
  readonly draft: FactoryDraft;
  readonly contract?: FactoryContract;
  readonly loading: boolean;
}

export const FactoryLibraryView = ({
  definitions,
  drafts,
  versions,
  activeFactoryId,
  onOpen,
  onCreate,
  onRename,
  onPublish,
  onInspectDraft,
  onForkVersion,
  onRevertDraft,
  onDeleteFactory,
  onDeleteVersion,
}: Props) => {
  const [selectedId, setSelectedId] = useState<FactoryId>(activeFactoryId);
  const [inspectedVersion, setInspectedVersion] = useState<FactoryVersion>();
  const [draftInspection, setDraftInspection] = useState<DraftInspection>();
  const selected =
    definitions.find((definition) => definition.id === selectedId) ??
    definitions[0];
  const selectedVersions = useMemo(
    () =>
      versions
        .filter((version) => version.factoryId === selected?.id)
        .sort((a, b) => b.version - a.version),
    [selected?.id, versions],
  );
  const draft = drafts.find((item) => item.factoryId === selected?.id);
  const latest = selectedVersions[0];
  const askCreate = () => {
    const name = window.prompt('New factory name');
    if (name?.trim()) onCreate(name);
  };
  const askRename = () => {
    if (selected === undefined) return;
    const name = window.prompt('New name', selected.name);
    if (name?.trim() && name.trim() !== selected.name)
      onRename(selected.id, name);
  };
  const askFork = (version: FactoryVersion) => {
    if (selected === undefined) return;
    const name = window.prompt('Fork name', `${selected.name} fork`);
    if (name?.trim()) onForkVersion(version, name);
  };
  const inspectDraft = async (value: FactoryDraft) => {
    setInspectedVersion(undefined);
    setDraftInspection({ draft: value, loading: true });
    try {
      const inspectedContract = await onInspectDraft(value);
      setDraftInspection({
        draft: value,
        ...(inspectedContract === undefined
          ? {}
          : { contract: inspectedContract }),
        loading: false,
      });
    } catch {
      setDraftInspection({ draft: value, loading: false });
    }
  };
  return (
    <section className="library-view" aria-label="Factory library">
      <aside className="library-list panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Designs</span>
            <h2>My factories</h2>
          </div>
          <button
            className="button-icon"
            onClick={askCreate}
            aria-label="Create factory"
            title="Create factory"
          >
            ＋
          </button>
        </div>
        {definitions.map((definition) => {
          const count = versions.filter(
            (version) => version.factoryId === definition.id,
          ).length;
          const hasDraft = drafts.some(
            (item) => item.factoryId === definition.id,
          );
          return (
            <button
              key={definition.id}
              className={`library-entry${selected?.id === definition.id ? ' active' : ''}`}
              onClick={() => setSelectedId(definition.id)}
            >
              <span>
                <strong>{definition.name}</strong>
                <small>
                  {hasDraft
                    ? `Draft${count === 0 ? '' : ` · ${count} published version${count > 1 ? 's' : ''}`}`
                    : `${count} published version${count === 1 ? '' : 's'}`}
                </small>
              </span>
              <b>{definition.id === activeFactoryId ? 'Open' : ''}</b>
            </button>
          );
        })}
      </aside>
      <div className="library-detail panel">
        {selected === undefined ? (
          <p>No factory.</p>
        ) : (
          <>
            <header>
              <div>
                <span className="eyebrow">Factory</span>
                <h1>{selected.name}</h1>
                <p>
                  {draft === undefined
                    ? latest === undefined
                      ? 'No draft or published version'
                      : `No draft · Edit starts from v${latest.version}`
                    : `Draft autosaved ${new Date(draft.autosavedAt).toLocaleString()}`}
                </p>
              </div>
              <div className="library-actions">
                <button className="button" onClick={() => onOpen(selected.id)}>
                  Edit
                </button>
                <button className="button" onClick={askRename}>
                  Rename
                </button>
                {draft === undefined && selectedVersions.length === 0 && (
                  <button
                    className="button button--danger"
                    onClick={() => onDeleteFactory(selected.id)}
                  >
                    Delete factory
                  </button>
                )}
                <button
                  className="button button--primary"
                  disabled={draft === undefined}
                  onClick={() => onPublish(selected.id)}
                >
                  Publish
                </button>
              </div>
            </header>
            <section className="version-history">
              <h2>Version history</h2>
              {draft !== undefined && (
                <article className="version-row version-row--draft">
                  <div>
                    <strong>Draft</strong>
                    <span>{new Date(draft.autosavedAt).toLocaleString()}</span>
                    <small>
                      {draft.blueprint.nodes.size} components ·{' '}
                      {draft.baseVersion === undefined
                        ? 'Not published yet'
                        : `Based on v${draft.baseVersion}`}
                    </small>
                  </div>
                  <div>
                    <button
                      className="button button--compact"
                      onClick={() => void inspectDraft(draft)}
                    >
                      Inspect
                    </button>
                    <button
                      className="button button--compact button--danger"
                      onClick={() => {
                        setDraftInspection(undefined);
                        onRevertDraft(selected.id);
                      }}
                    >
                      Revert
                    </button>
                  </div>
                </article>
              )}
              {draft === undefined && selectedVersions.length === 0 && (
                <p className="catalogue-empty">
                  No draft or published version.
                </p>
              )}
              {selectedVersions.map((version) => (
                <article key={version.version} className="version-row">
                  <div>
                    <strong>v{version.version}</strong>
                    <span>
                      {new Date(version.publishedAt).toLocaleString()}
                    </span>
                    <small>
                      {version.blueprint.nodes.size} components ·{' '}
                      {version.contract.blueprintHash.slice(0, 10)}
                    </small>
                  </div>
                  <div>
                    <button
                      className="button button--compact"
                      onClick={() => {
                        setDraftInspection(undefined);
                        setInspectedVersion(version);
                      }}
                    >
                      Inspect
                    </button>
                    <button
                      className="button button--compact"
                      onClick={() => askFork(version)}
                    >
                      Fork
                    </button>
                    <button
                      className="button button--compact button--danger"
                      onClick={() => onDeleteVersion(version)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
              {draftInspection !== undefined &&
                draftInspection.draft.factoryId === selected.id && (
                  <aside
                    className="version-inspection"
                    aria-label="Draft inspection"
                  >
                    <header>
                      <div>
                        <span className="eyebrow">Autosaved draft</span>
                        <h3>{selected.name} · Draft</h3>
                      </div>
                      <button
                        className="button-icon button-icon--small"
                        aria-label="Close draft inspection"
                        title="Close"
                        onClick={() => setDraftInspection(undefined)}
                      >
                        ×
                      </button>
                    </header>
                    <dl>
                      <div>
                        <dt>Components</dt>
                        <dd>{draftInspection.draft.blueprint.nodes.size}</dd>
                      </div>
                      <div>
                        <dt>Routes</dt>
                        <dd>{draftInspection.draft.blueprint.edges.size}</dd>
                      </div>
                      <div>
                        <dt>Inputs</dt>
                        <dd>
                          {draftInspection.loading
                            ? '…'
                            : (draftInspection.contract?.inputRates.size ??
                              '—')}
                        </dd>
                      </div>
                      <div>
                        <dt>Outputs</dt>
                        <dd>
                          {draftInspection.loading
                            ? '…'
                            : (draftInspection.contract?.outputRates.size ??
                              '—')}
                        </dd>
                      </div>
                      {draftInspection.contract !== undefined && (
                        <div>
                          <dt>Footprint</dt>
                          <dd>
                            {draftInspection.contract.footprint.width} ×{' '}
                            {draftInspection.contract.footprint.height}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {draftInspection.loading ? (
                      <p className="inspection-status">Compiling draft…</p>
                    ) : draftInspection.contract === undefined ? (
                      <p className="inspection-status inspection-status--invalid">
                        Inputs and outputs are unavailable until the draft
                        compiles.
                      </p>
                    ) : (
                      <FactoryFlowSummary
                        name={selected.name}
                        subtitle="Draft contract"
                        contract={draftInspection.contract}
                      />
                    )}
                    <FactoryDependencyGraph
                      definitions={definitions}
                      versions={versions}
                      root={draftInspection.draft}
                    />
                    <ComponentCountSummary
                      blueprint={draftInspection.draft.blueprint}
                    />
                  </aside>
                )}
              {inspectedVersion !== undefined &&
                inspectedVersion.factoryId === selected.id && (
                  <aside
                    className="version-inspection"
                    aria-label={`Read-only version ${inspectedVersion.version}`}
                  >
                    <header>
                      <div>
                        <span className="eyebrow">Immutable snapshot</span>
                        <h3>
                          {selected.name} · v{inspectedVersion.version}
                        </h3>
                      </div>
                      <button
                        className="button-icon button-icon--small"
                        aria-label="Close version inspection"
                        title="Close"
                        onClick={() => setInspectedVersion(undefined)}
                      >
                        ×
                      </button>
                    </header>
                    <dl>
                      <div>
                        <dt>Components</dt>
                        <dd>{inspectedVersion.blueprint.nodes.size}</dd>
                      </div>
                      <div>
                        <dt>Routes</dt>
                        <dd>{inspectedVersion.blueprint.edges.size}</dd>
                      </div>
                      <div>
                        <dt>Inputs</dt>
                        <dd>{inspectedVersion.contract.inputRates.size}</dd>
                      </div>
                      <div>
                        <dt>Outputs</dt>
                        <dd>{inspectedVersion.contract.outputRates.size}</dd>
                      </div>
                      <div>
                        <dt>Footprint</dt>
                        <dd>
                          {inspectedVersion.contract.footprint.width} ×{' '}
                          {inspectedVersion.contract.footprint.height}
                        </dd>
                      </div>
                    </dl>
                    <FactoryFlowSummary
                      name={selected.name}
                      subtitle={`v${inspectedVersion.version} contract`}
                      contract={inspectedVersion.contract}
                    />
                    <FactoryDependencyGraph
                      definitions={definitions}
                      versions={versions}
                      root={inspectedVersion}
                    />
                    <ComponentCountSummary
                      blueprint={inspectedVersion.blueprint}
                    />
                  </aside>
                )}
            </section>
          </>
        )}
      </div>
    </section>
  );
};
