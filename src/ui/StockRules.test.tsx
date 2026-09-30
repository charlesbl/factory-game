import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { asId } from '../domain';
import type { RailNodeId, ResourceId } from '../domain';
import { StockRules } from './StockRules';

describe('stock rule editor', () => {
  it('shows both thresholds and excludes existing resources from the add selector', () => {
    const html = renderToStaticMarkup(
      <StockRules
        busy={false}
        onChange={() => undefined}
        stations={[
          {
            id: 'rule:storage:ironPlate',
            railNodeId: asId<RailNodeId>('rail'),
            role: 'storage',
            resourceId: asId<ResourceId>('ironPlate'),
            quantity: 90,
            capacity: 500,
            target: 50,
            stockMaximum: 100,
            priority: 0,
          },
        ]}
      />,
    );
    expect(html).toContain('ironPlate minimum');
    expect(html).toContain('ironPlate maximum');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="100"');
    expect(html).not.toContain('<option value="ironPlate"');
    expect(html).toContain('<option value="copperWire"');
  });
});
