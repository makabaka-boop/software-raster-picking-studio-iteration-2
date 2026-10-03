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

let drawn: Uint8ClampedArray[] = [];

const createCanvas = () => {
  const ctx = {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (imageData: ImageData) => {
      drawn.push(new Uint8ClampedArray(imageData.data));
    },
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
};

/** Lets the viewer's scheduled render callback run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Builds a 1x1 frame with one covered pixel, matching real worker
 * semantics: an overlay-off frame carries a null edge layer, an on frame
 * a mask whose single pixel is `edge`.
 */
const frameResponse = (seq: number, id: number, edges: Uint8Array | null): RenderResponse => {
  const colors = new Uint8ClampedArray(4);
  colors[0] = 10;
  colors[1] = 20;
  colors[2] = 30;
  colors[3] = 255;
  return {
    type: 'frame',
    seq,
    width: 1,
    height: 1,
    colors,
    depth: new Float32Array(1).fill(2),
    primitiveId: new Int32Array(1).fill(id),
    edges,
  };
};

const edgeOn = new Uint8Array(1).fill(1);

const createViewer = (worker: FakeWorker): TriangleViewer =>
  new TriangleViewer(createCanvas(), {
    width: 1,
    height: 1,
    createWorker: () => worker as unknown as Worker,
  });

const drawnPixel = (): [number, number, number] => {
  const last = drawn.at(-1)!;
  return [last[0], last[1], last[2]];
};

describe('wireframe toggle and same-frame coherence', () => {
  it('tints only the display copy and never the committed colour or picking buffers', async () => {
    drawn = [];
    const worker = new FakeWorker();
    const viewer = createViewer(worker);
    await flush();

    expect(worker.requests[0].showEdges).toBe(false);
    worker.respond(frameResponse(1, 7, null));
    expect(viewer.pick(0, 0)).toBe(7);
    expect(drawnPixel()).toEqual([10, 20, 30]);

    viewer.setWireframe(true);
    expect(worker.requests).toHaveLength(1); // the new request is rAF-coalesced
    await flush();
    expect(worker.requests).toHaveLength(2);
    expect(worker.requests[1].showEdges).toBe(true);
    worker.respond(frameResponse(2, 7, edgeOn));

    // The displayed pixel is tinted; the committed buffers are untouched.
    expect(drawnPixel()).toEqual([255, 255, 0]);
    expect(viewer.pick(0, 0)).toBe(7);
    const committed = viewer.getFrame()!;
    expect([committed.colors[0], committed.colors[1], committed.colors[2]]).toEqual([10, 20, 30]);
    expect(committed.edges![0]).toBe(1);

    // Turning the overlay off restores the exact base image, still from
    // the same committed frame and with identical picking evidence.
    viewer.setWireframe(false);
    expect(drawnPixel()).toEqual([10, 20, 30]);
    expect(viewer.pick(0, 0)).toBe(7);
    expect(viewer.getFrame()?.seq).toBe(2);
    viewer.dispose();
  });

  it('rejects a late old-model edge layer after rotation or a toggle', async () => {
    drawn = [];
    const worker = new FakeWorker();
    const viewer = createViewer(worker);
    await flush();
    worker.respond(frameResponse(1, 7, null));
    expect(drawnPixel()).toEqual([10, 20, 30]);

    // Toggle on: frame 2 with edges is in flight.
    viewer.setWireframe(true);
    await flush();
    expect(worker.requests[1].seq).toBe(2);

    // Rotate before frame 2 arrives: frame 3 supersedes it.
    viewer.setRotation(0.5, 0);
    await flush();
    expect(worker.requests[2].seq).toBe(3);
    expect(worker.requests[2].showEdges).toBe(true);

    // The late overlay-on frame 2 must not commit its edge layer or ids.
    worker.respond(frameResponse(2, 99, edgeOn));
    expect(viewer.getFrame()?.seq).toBe(1);
    expect(viewer.pick(0, 0)).toBe(7);
    expect(drawnPixel()).toEqual([10, 20, 30]);

    // Frame 3 arrives with edges and picking for the rotated model;
    // display and picking move together.
    worker.respond(frameResponse(3, 11, edgeOn));
    expect(viewer.getFrame()?.seq).toBe(3);
    expect(drawnPixel()).toEqual([255, 255, 0]);
    expect(viewer.pick(0, 0)).toBe(11);

    // Toggle off: the overlay lifts at once and frame 4 is requested. A
    // late frame 3 must never cover frame 4's picture.
    viewer.setWireframe(false);
    expect(drawnPixel()).toEqual([10, 20, 30]);
    await flush();
    const offSeq = worker.requests.at(-1)!.seq;
    expect(offSeq).toBe(4);
    worker.respond(frameResponse(3, 11, edgeOn)); // stale overlay frame
    expect(viewer.getFrame()?.seq).toBe(3);
    expect(viewer.pick(0, 0)).toBe(11);

    worker.respond(frameResponse(offSeq, 12, null));
    expect(viewer.getFrame()?.seq).toBe(offSeq);
    expect(drawnPixel()).toEqual([10, 20, 30]);
    expect(viewer.pick(0, 0)).toBe(12);
    viewer.dispose();
  });

  it('stays coherent while toggling quickly: every drawn image matches its pick evidence', async () => {
    drawn = [];
    const worker = new FakeWorker();
    const viewer = createViewer(worker);
    await flush();
    const coherent = () => ({
      shown: drawnPixel(),
      pick: viewer.pick(0, 0),
      seq: viewer.getFrame()?.seq,
    });

    worker.respond(frameResponse(1, 1, null));
    expect(coherent()).toMatchObject({ shown: [10, 20, 30], pick: 1, seq: 1 });

    // Rapid on/off/on before any frame finishes: rAF coalescing merges the
    // three state changes into one request for the final (on) state.
    viewer.setWireframe(true);
    viewer.setWireframe(false);
    viewer.setWireframe(true);
    await flush();
    const toggledRequest = worker.requests.at(-1)!;
    expect(toggledRequest.showEdges).toBe(true);
    // Nothing new is committed until the matching frame returns.
    expect(coherent().seq).toBe(1);

    // A response for the collapsed middle (off) generation never existed
    // and cannot commit; the current frame commits atomically.
    worker.respond(frameResponse(toggledRequest.seq, 3, edgeOn));
    expect(coherent()).toMatchObject({ shown: [255, 255, 0], pick: 3, seq: toggledRequest.seq });

    // Rapid off plus rotation: only the final request survives.
    viewer.setWireframe(false);
    viewer.setRotation(1, 0);
    await flush();
    const finalRequest = worker.requests.at(-1)!;
    expect(finalRequest.showEdges).toBe(false);
    // A stale edge frame for the previous generation never lands on top.
    worker.respond(frameResponse(toggledRequest.seq, 3, edgeOn));
    expect(coherent().seq).toBe(toggledRequest.seq);
    worker.respond(frameResponse(finalRequest.seq, 4, null));
    expect(coherent()).toMatchObject({ shown: [10, 20, 30], pick: 4, seq: finalRequest.seq });
    viewer.dispose();
  });
});
