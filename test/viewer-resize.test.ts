import { describe, expect, it } from 'vitest';
import { TriangleViewer } from '../src/viewer';
import type { RenderRequest, RenderResponse } from '../src/types';

class FakeWorker {
  onmessage: ((event: MessageEvent<RenderResponse>) => void) | null = null;
  readonly requests: RenderRequest[] = [];

  postMessage(request: RenderRequest): void {
    this.requests.push(request);
  }

  respond(response: RenderResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<RenderResponse>);
  }

  terminate(): void {}
}

const createCanvas = (): HTMLCanvasElement => {
  const ctx = {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: () => {},
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
};

const frameResponse = (seq: number, width: number, height: number, id: number): RenderResponse => ({
  type: 'frame',
  seq,
  width,
  height,
  colors: new Uint8ClampedArray(width * height * 4),
  depth: new Float32Array(width * height),
  primitiveId: new Int32Array(width * height).fill(id),
});

/** Lets the viewer's scheduled render callback run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('resize while a frame is in flight', () => {
  it('invalidates the old frame and rejects late old-size responses', async () => {
    const worker = new FakeWorker();
    const viewer = new TriangleViewer(createCanvas(), {
      width: 4,
      height: 4,
      createWorker: () => worker as unknown as Worker,
    });
    await flush();
    expect(worker.requests).toHaveLength(1);

    worker.respond(frameResponse(1, 4, 4, 3));
    expect(viewer.getFrame()?.width).toBe(4);
    expect(viewer.pick(0, 0)).toBe(3);

    viewer.setSize(2, 2);
    // The 4x4 frame is dropped synchronously: until the resized frame is
    // committed it must not be drawn, picked, or returned.
    expect(viewer.getFrame()).toBe(null);
    expect(viewer.pick(0, 0)).toBe(-1);

    // A late response rendered at the old size is rejected instead of
    // being committed into the smaller ImageData buffer.
    expect(() => worker.respond(frameResponse(1, 4, 4, 5))).not.toThrow();
    expect(viewer.getFrame()).toBe(null);

    await flush();
    const resizedRequest = worker.requests.at(-1);
    expect(resizedRequest?.width).toBe(2);
    expect(resizedRequest?.height).toBe(2);

    worker.respond(frameResponse(resizedRequest!.seq, 2, 2, 7));
    expect(viewer.getFrame()?.width).toBe(2);
    expect(viewer.pick(1, 1)).toBe(7);

    viewer.dispose();
  });
});
