import {
  commitResponse,
  createFrameState,
  pickPrimitiveId,
  resizeFrameState,
  type CommittedFrame,
  type FrameCommitState,
} from './frame';
import { MAX_HEIGHT, MAX_WIDTH, type Camera, type Mesh, type RenderResponse } from './types';

export interface ViewerOptions {
  width?: number;
  height?: number;
  mesh?: Mesh;
  position?: Camera['position'];
  createWorker?: () => Worker;
}

const defaultWorkerFactory = (): Worker =>
  new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });

export class TriangleViewer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private imageData: ImageData;
  private readonly worker: Worker;
  private mesh: Mesh;
  private width: number;
  private height: number;
  private camera: Camera;
  private frameState: FrameCommitState;
  private renderQueued = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: ViewerOptions = {}) {
    this.canvas = canvas;
    this.width = clampSize(options.width ?? (canvas.width || 320), MAX_WIDTH);
    this.height = clampSize(options.height ?? (canvas.height || 240), MAX_HEIGHT);
    canvas.width = this.width;
    canvas.height = this.height;

    const ctx2d = canvas.getContext('2d');
    if (ctx2d === null) throw new Error('Canvas 2D context is unavailable');
    this.ctx2d = ctx2d;
    this.imageData = ctx2d.createImageData(this.width, this.height);

    this.mesh = options.mesh ?? { vertices: [], indices: [] };
    this.camera = {
      position: options.position ?? [0, 0, 0],
      yaw: 0,
      pitch: 0,
      focalLength: Math.min(this.width, this.height) / 2,
    };

    this.frameState = createFrameState(this.width, this.height);

    this.worker = (options.createWorker ?? defaultWorkerFactory)();
    this.worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const response = event.data;
      if (!commitResponse(this.frameState, response)) return;
      if (response.type === 'error') {
        console.error(response.message);
        return;
      }

      // commitResponse has already rejected old generations and old sizes,
      // so the color, depth and picking buffers always change together.
      const frame = this.frameState.frame;
      if (frame === null) return;
      this.imageData.data.set(frame.colors);
      this.ctx2d.putImageData(this.imageData, 0, 0);
    };

    this.requestRender();
  }

  setMesh(mesh: Mesh): void {
    this.mesh = mesh;
    this.requestRender();
  }

  setRotation(yaw: number, pitch: number): void {
    this.camera.yaw = yaw;
    this.camera.pitch = pitch;
    this.requestRender();
  }

  getRotation(): { yaw: number; pitch: number } {
    return { yaw: this.camera.yaw, pitch: this.camera.pitch };
  }

  setSize(width: number, height: number): void {
    const nextWidth = clampSize(width, MAX_WIDTH);
    const nextHeight = clampSize(height, MAX_HEIGHT);
    if (nextWidth === this.width && nextHeight === this.height) return;

    this.width = nextWidth;
    this.height = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    this.imageData = this.ctx2d.createImageData(nextWidth, nextHeight);
    this.camera.focalLength = Math.min(nextWidth, nextHeight) / 2;
    // Invalidate the old frame before the resized one is committed: a late
    // worker frame rendered at the previous size must not be drawn into
    // the new ImageData or serve picks.
    resizeFrameState(this.frameState, nextWidth, nextHeight);
    this.requestRender();
  }

  getFrame(): CommittedFrame | null {
    return this.frameState.frame;
  }

  /** Reads only the current committed primitive-id buffer. */
  pick(x: number, y: number): number {
    return pickPrimitiveId(this.frameState.frame, Math.trunc(x), Math.trunc(y));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameState.seq += 1;
    this.worker.terminate();
  }

  private requestRender(): void {
    if (this.disposed || this.renderQueued) return;
    this.renderQueued = true;
    const schedule: (callback: () => void) => FrameRequestCallback | number =
      globalThis.requestAnimationFrame ??
      ((callback: () => void) => setTimeout(callback, 0));

    schedule(() => {
      this.renderQueued = false;
      if (this.disposed) return;
      const state = this.frameState;
      state.seq += 1;
      state.width = this.width;
      state.height = this.height;
      this.worker.postMessage({
        seq: state.seq,
        width: this.width,
        height: this.height,
        camera: this.camera,
        mesh: this.mesh,
      });
    });
  }
}

function clampSize(value: number, max: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('size must be a positive integer');
  }
  return Math.min(value, max);
}
