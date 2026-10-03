/// <reference lib="webworker" />
import { renderFrame } from './renderer';
import type { RenderRequest, RenderResponse } from './types';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  try {
    const frame = renderFrame(
      request.width,
      request.height,
      request.camera,
      request.mesh,
      request.showEdges,
    );
    const response: RenderResponse = {
      type: 'frame',
      seq: request.seq,
      width: frame.width,
      height: frame.height,
      colors: frame.colors,
      depth: frame.depth,
      primitiveId: frame.primitiveId,
      edges: frame.edges,
    };
    // The edge layer travels with the base buffers in one message and is
    // transferred together, so it is committed as part of the same frame.
    const transferables: Transferable[] = [frame.colors.buffer, frame.depth.buffer, frame.primitiveId.buffer];
    if (frame.edges !== null) transferables.push(frame.edges.buffer);
    workerScope.postMessage(response, transferables);
  } catch (error) {
    const response: RenderResponse = {
      type: 'error',
      seq: request.seq,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};
