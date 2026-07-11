import { describe, expect, it } from 'vitest';
import { asId } from '../domain';
import type { ResourceId } from '../domain';
import { compileBlueprint, isContract } from '../compiler';
import { createDemoBlueprint } from '../ui/demo-blueprint';
import { FactoryRuntimeInstance } from './instance';
import { EventScheduler } from './scheduler';

const runtime = () => {
  const compiled = compileBlueprint(createDemoBlueprint());
  if (!isContract(compiled)) throw new Error('Fixture must compile');
  return new FactoryRuntimeInstance(asId('instance-test'), compiled, 10);
};
describe('event-driven runtime', () => {
  it('loads integer input and materialises integer output exactly', () => {
    const actor = runtime();
    const scheduler = new EventScheduler();
    actor.addInput(asId<ResourceId>('ironOre'), 10);
    scheduler.register(actor);
    scheduler.advanceTo(FactoryRuntimeInstance.seconds(5));
    expect(
      Number.isInteger(actor.inputs.get(asId<ResourceId>('ironOre'))!.quantity),
    ).toBe(true);
    expect(actor.outputs.get(asId<ResourceId>('ironIngot'))!.quantity).toBe(5);
  });
  it('sleeps while waiting and wakes on delivery', () => {
    const actor = runtime();
    const scheduler = new EventScheduler();
    scheduler.register(actor);
    expect(actor.state).toBe('WAITING_INPUT');
    expect(scheduler.scheduledEvents).toBe(0);
    actor.addInput(asId<ResourceId>('ironOre'), 1);
    scheduler.schedule(actor);
    expect(actor.state).toBe('RUNNING');
  });
  it('subdivision does not change state', () => {
    const one = runtime();
    const many = runtime();
    one.addInput(asId<ResourceId>('ironOre'), 10);
    many.addInput(asId<ResourceId>('ironOre'), 10);
    const a = new EventScheduler();
    const b = new EventScheduler();
    a.register(one);
    b.register(many);
    a.advanceTo(FactoryRuntimeInstance.seconds(4));
    for (let step = 1; step <= 40; step += 1)
      b.advanceTo(FactoryRuntimeInstance.seconds(step / 10));
    expect(many.getSnapshot().outputs).toEqual(one.getSnapshot().outputs);
    expect(many.getSnapshot().outputWork).toEqual(one.getSnapshot().outputWork);
  });
  it('continues exactly after a snapshot round-trip', () => {
    const original = runtime();
    original.addInput(asId<ResourceId>('ironOre'), 10);
    const first = new EventScheduler();
    first.register(original);
    first.advanceTo(FactoryRuntimeInstance.seconds(2.25));
    const restored = FactoryRuntimeInstance.restore(
      original.getSnapshot(),
      original.contract,
    );
    const second = new EventScheduler();
    second.register(restored);
    first.advanceTo(FactoryRuntimeInstance.seconds(5));
    second.advanceTo(FactoryRuntimeInstance.seconds(5));
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());
  });
});
