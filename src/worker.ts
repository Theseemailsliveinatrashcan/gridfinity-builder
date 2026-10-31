/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { generate, type GenerateRequest } from './geometry/generate';
import { freeAll, initKernel } from './geometry/kernel';
import type { BatchRequest, BatchReply } from './planner/batch';

const ready = initKernel(() => wasmUrl);

type SingleRequest = { id: number; req: GenerateRequest };
export type WorkerResponse =
  | { id: number; ok: true; result: ReturnType<typeof generate>; ms: number }
  | { id: number; ok: false; error: string };

function isBatchRequest(data: SingleRequest | BatchRequest): data is BatchRequest {
  return 'type' in data && data.type === 'generate';
}

self.onmessage = async (event: MessageEvent<SingleRequest | BatchRequest>) => {
  const request = event.data;
  try {
    await ready;
    const start = performance.now();
    const options = isBatchRequest(request) ? request.options : undefined;
    const result = generate(request.req, options);
    const ms = performance.now() - start;
    // Typed parts and the legacy pieces adapter share these buffers.
    const transfer = [...new Set(result.pieces.flatMap(piece => [piece.positions.buffer, piece.indices.buffer]))];
    const reply: WorkerResponse | BatchReply = isBatchRequest(request)
      ? { type: 'result', batchId: request.batchId, jobId: request.jobId, key: request.key, result, ms }
      : { id: request.id, ok: true, result, ms };
    (self as unknown as Worker).postMessage(reply, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reply: WorkerResponse | BatchReply = isBatchRequest(request)
      ? { type: 'error', batchId: request.batchId, jobId: request.jobId, key: request.key, error: message }
      : { id: request.id, ok: false, error: message };
    (self as unknown as Worker).postMessage(reply);
  } finally {
    freeAll();
  }
};
