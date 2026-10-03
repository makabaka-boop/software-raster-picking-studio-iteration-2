import { describe, expect, it } from 'vitest';
import {
  commitResponse,
  createFrameSnapshot,
  createFrameState,
  isFrameFor,
  pickPrimitiveId,
} from '../src/frame';

const frame = () =>
  createFrameSnapshot(
    7,
    2,
    2,
    new Uint8ClampedArray(16),
    new Float32Array(4),
    new Int32Array([0, 1, 2, -1]),
  );

describe('committed frame picking', () => {
  it('only reads the primitive-id buffer for the current frame', () => {
    expect(pickPrimitiveId(frame(), 0, 0)).toBe(0);
    expect(pickPrimitiveId(frame(), 1, 1)).toBe(-1);
    expect(pickPrimitiveId(null, 0, 0)).toBe(-1);
    expect(pickPrimitiveId(frame(), -1, 0)).toBe(-1);
    expect(pickPrimitiveId(frame(), 2, 0)).toBe(-1);
    expect(pickPrimitiveId(frame(), 0, 2)).toBe(-1);
  });

  it('rejects stale sequence numbers and resized dimensions', () => {
    expect(isFrameFor(frame(), 7, 2, 2)).toBe(true);
    expect(isFrameFor(frame(), 6, 2, 2)).toBe(false);
    expect(isFrameFor(frame(), 7, 3, 2)).toBe(false);
    expect(isFrameFor(frame(), 7, 2, 3)).toBe(false);
    expect(isFrameFor(null, 1, 2, 2)).toBe(false);
  });

  it('commits the edge layer together with the base buffers of one frame', () => {
    const state = createFrameState(2, 2);
    state.seq = 1;
    const edges = new Uint8Array(4).fill(1);
    const committed = commitResponse(state, {
      type: 'frame',
      seq: 1,
      width: 2,
      height: 2,
      colors: new Uint8ClampedArray(16),
      depth: new Float32Array(4),
      primitiveId: new Int32Array(4).fill(5),
      edges,
    });
    expect(committed).toBe(true);
    expect(state.frame?.edges).toBe(edges);
    expect(state.frame?.primitiveId[0]).toBe(5);

    // A late frame carrying another edge layer changes nothing: the old
    // edges, colour and id buffers stay bound to the committed frame.
    const stale = commitResponse(state, {
      type: 'frame',
      seq: 0,
      width: 2,
      height: 2,
      colors: new Uint8ClampedArray(16),
      depth: new Float32Array(4),
      primitiveId: new Int32Array(4).fill(9),
      edges: new Uint8Array(4),
    });
    expect(stale).toBe(false);
    expect(state.frame?.edges).toBe(edges);
    expect(state.frame?.primitiveId[0]).toBe(5);
  });
});
