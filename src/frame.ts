import type { RenderFrame, RenderResponse } from './types';

export interface CommittedFrame extends RenderFrame {
  /** Monotonic frame generation number. */
  seq: number;
}

export interface FrameCommitState {
  seq: number;
  width: number;
  height: number;
  frame: CommittedFrame | null;
  lastError: string | null;
}

export function createFrameState(width: number, height: number): FrameCommitState {
  return { seq: 0, width, height, frame: null, lastError: null };
}

/**
 * Synchronously invalidate the committed frame when the output size
 * changes. Bumping the generation and recording the new dimensions right
 * away guarantees a late worker response rendered at the old size can
 * never be committed, drawn, or picked against the resized canvas.
 */
export function resizeFrameState(state: FrameCommitState, width: number, height: number): void {
  state.seq += 1;
  state.width = width;
  state.height = height;
  state.frame = null;
}

export function isFrameFor(frame: CommittedFrame | null, seq: number, width: number, height: number): boolean {
  return frame !== null && frame.seq === seq && frame.width === width && frame.height === height;
}

/**
 * Apply a worker response using the exact stale-frame rule. A response is
 * accepted only when its generation and dimensions are both current. The
 * edge layer is committed in the same snapshot as the color, depth and
 * primitive-id buffers, so the overlay can never come from another frame.
 */
export function commitResponse(state: FrameCommitState, response: RenderResponse): boolean {
  if (response.seq !== state.seq) return false;

  if (response.type === 'error') {
    state.lastError = response.message;
    return true;
  }

  if (response.width !== state.width || response.height !== state.height) return false;
  state.frame = createFrameSnapshot(
    response.seq,
    response.width,
    response.height,
    response.colors,
    response.depth,
    response.primitiveId,
    response.edges,
  );
  state.lastError = null;
  return true;
}

export function createFrameSnapshot(
  seq: number,
  width: number,
  height: number,
  colors: Uint8ClampedArray,
  depth: Float32Array,
  primitiveId: Int32Array,
  edges: Uint8Array | null = null,
): CommittedFrame {
  return { seq, width, height, colors, depth, primitiveId, edges };
}

/**
 * Picking is a direct lookup in the committed primitive-id buffer. It does
 * not perform a separate ray/triangle approximation.
 */
export function pickPrimitiveId(frame: CommittedFrame | null, x: number, y: number): number {
  if (frame === null) return -1;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return -1;
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return -1;
  return frame.primitiveId[y * frame.width + x];
}
