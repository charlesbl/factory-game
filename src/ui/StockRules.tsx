import { useState } from 'react';
import { resources } from '../domain';
import type { ResourceId } from '../domain';
import type { WorldStationSnapshot } from '../world';

function StockRange({
  station,
  busy,
  onChange,
}: {
  station: WorldStationSnapshot;
  busy: boolean;
  onChange: (resourceId: ResourceId, minimum: number, maximum: number) => void;
}) {
  const [draft, setDraft] = useState<{ minimum: number; maximum: number }>();
  const minimum = draft?.minimum ?? station.target;
  const maximum = draft?.maximum ?? station.stockMaximum ?? 0;
  const capacity = station.capacity ?? 1000;
  const commit = () => {
    if (draft) onChange(station.resourceId!, draft.minimum, draft.maximum);
    setDraft(undefined);
  };
  return (
    <div className="world-stock-rule">
      <strong>
        {resources.find((item) => item.id === station.resourceId)?.name ??
          station.resourceId}
      </strong>
      <small>
        Stock {station.quantity ?? 0} · min {minimum} · max {maximum}
      </small>
      <div className="world-stock-range">
        <div
          className="world-stock-range-fill"
          style={{
            left: `${(minimum / capacity) * 100}%`,
            right: `${100 - (maximum / capacity) * 100}%`,
          }}
        />
        <input
          aria-label={`${station.resourceId} minimum`}
          type="range"
          min={0}
          max={capacity}
          value={minimum}
          disabled={busy}
          style={{ zIndex: minimum === capacity ? 4 : 2 }}
          onChange={(event) => {
            const value = Number(event.target.value);
            setDraft({ minimum: value, maximum: Math.max(value, maximum) });
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <input
          aria-label={`${station.resourceId} maximum`}
          type="range"
          min={0}
          max={capacity}
          value={maximum}
          disabled={busy}
          onChange={(event) => {
            const value = Number(event.target.value);
            setDraft({ minimum: Math.min(minimum, value), maximum: value });
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

export function StockRules({
  stations,
  busy,
  onChange,
}: {
  stations: readonly WorldStationSnapshot[];
  busy: boolean;
  onChange: (resourceId: ResourceId, minimum: number, maximum: number) => void;
}) {
  const available = resources.filter(
    (resource) =>
      !stations.some((station) => station.resourceId === resource.id),
  );
  const [selected, setSelected] = useState('');
  const resourceId =
    available.find((resource) => resource.id === selected)?.id ??
    available[0]?.id;
  return (
    <div className="world-rule-editor">
      <h4>Stock rules</h4>
      <p className="world-empty-state">
        All stock is available to the network. Below min: request supplies.
        Above max: send surplus. Accept active supplies up to max. Storage
        replenishment uses stock above the source’s min.
      </p>
      {stations.map((station) => (
        <StockRange
          key={station.id}
          station={station}
          busy={busy}
          onChange={onChange}
        />
      ))}
      <select
        aria-label="Rule resource"
        value={resourceId ?? ''}
        disabled={busy || !resourceId}
        onChange={(event) => setSelected(event.target.value)}
      >
        {available.map((resource) => (
          <option key={resource.id} value={resource.id}>
            {resource.name}
          </option>
        ))}
        {!resourceId && <option value="">All items already have a rule</option>}
      </select>
      <button
        disabled={busy || !resourceId}
        onClick={() => {
          if (resourceId) onChange(resourceId, 0, 0);
        }}
      >
        Add stock rule
      </button>
    </div>
  );
}
