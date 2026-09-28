import type { WorldSnapshot } from '../../world/model';

export interface WorldSessionState {
  readonly snapshot?: WorldSnapshot;
  readonly busy: boolean;
  readonly saveState: 'saved' | 'dirty' | 'saving' | 'error';
  readonly error?: string | undefined;
  readonly workerFailed: boolean;
  readonly generation: number;
}

/** One accepted state shared by the viewport, HUD and persistence owner. */
export class WorldStore {
  private state: WorldSessionState = {
    busy: true,
    saveState: 'saved',
    workerFailed: false,
    generation: 0,
  };
  private readonly listeners = new Set<() => void>();
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish(state: WorldSessionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
