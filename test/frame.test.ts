import { describe, expect, it } from 'vitest';
import { createFrameSnapshot, isFrameFor, pickPrimitiveId } from '../src/frame';

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
});
