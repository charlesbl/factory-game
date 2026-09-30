import { OreKind, TerrainKind, type WorldGrid } from '../../world/model';

/** Rasterize terrain only when its data or minimap dimensions change. */
export class MinimapBackground {
  private canvas: HTMLCanvasElement | undefined;
  private grid: WorldGrid | undefined;
  private showOre = false;

  draw(context: CanvasRenderingContext2D, grid: WorldGrid, showOre: boolean) {
    const { width, height } = context.canvas;
    const previous = this.grid;
    if (
      !this.canvas ||
      this.canvas.width !== width ||
      this.canvas.height !== height ||
      previous?.width !== grid.width ||
      previous.height !== grid.height ||
      previous.terrain !== grid.terrain ||
      previous.oreKinds !== grid.oreKinds ||
      (showOre && previous.oreRemaining !== grid.oreRemaining) ||
      this.showOre !== showOre
    ) {
      this.canvas ??= document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      const background = this.canvas.getContext('2d');
      if (!background) return;
      background.fillStyle = '#819778';
      background.fillRect(0, 0, width, height);
      const sx = width / grid.width;
      const sy = height / grid.height;
      background.fillStyle = '#68746b';
      for (let index = 0; index < grid.terrain.length; index++)
        if (grid.terrain[index] === TerrainKind.OBSTACLE)
          background.fillRect(
            (index % grid.width) * sx,
            Math.floor(index / grid.width) * sy,
            Math.max(1, sx),
            Math.max(1, sy),
          );
      if (showOre)
        for (let index = 0; index < grid.oreKinds.length; index++)
          if (
            grid.oreKinds[index] !== OreKind.NONE &&
            grid.oreRemaining[index] !== 0
          ) {
            background.fillStyle =
              grid.oreKinds[index] === OreKind.IRON ? '#7ab3a5' : '#b8754b';
            background.fillRect(
              (index % grid.width) * sx,
              Math.floor(index / grid.width) * sy,
              Math.max(1, sx * 1.8),
              Math.max(1, sy * 1.8),
            );
          }
      this.grid = grid;
      this.showOre = showOre;
    }
    context.drawImage(this.canvas, 0, 0);
  }
}
