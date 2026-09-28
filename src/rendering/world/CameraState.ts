export interface CameraState {
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly azimuth: number;
  readonly elevation: number;
  readonly orbitElevation: number;
  readonly preset: 'orbit' | 'top';
}

export function readCamera(worldId: string): CameraState | undefined {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`factory-world-camera-v1:${worldId}`) ?? 'null',
    );
    if (typeof value !== 'object' || value === null) return undefined;
    const camera = value as CameraState;
    if (
      ![
        camera.x,
        camera.z,
        camera.distance,
        camera.azimuth,
        camera.elevation,
        camera.orbitElevation,
      ].every((item) => typeof item === 'number' && Number.isFinite(item))
    )
      return undefined;
    if (camera.preset !== 'orbit' && camera.preset !== 'top') return undefined;
    return camera;
  } catch {
    return undefined;
  }
}
