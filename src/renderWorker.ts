/// <reference lib="webworker" />
import { renderFrame } from './renderer';
import type { RenderRequest, RenderResponse } from './types';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  try {
    const frame = renderFrame(request.width, request.height, request.camera, request.mesh);
    const response: RenderResponse = {
      type: 'frame',
      seq: request.seq,
      width: frame.width,
      height: frame.height,
      colors: frame.colors,
      depth: frame.depth,
      primitiveId: frame.primitiveId,
    };
    workerScope.postMessage(
      response,
      [frame.colors.buffer, frame.depth.buffer, frame.primitiveId.buffer],
    );
  } catch (error) {
    const response: RenderResponse = {
      type: 'error',
      seq: request.seq,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};
