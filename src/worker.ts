/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { generate, type GenerateRequest } from './geometry/generate';
import { freeAll, initKernel } from './geometry/kernel';

const ready = initKernel(() => wasmUrl);

export type WorkerResponse =
  | { id: number; ok: true; result: ReturnType<typeof generate>; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<{ id: number; req: GenerateRequest }>) => {
  const { id, req } = e.data;
  try {
    await ready;
    const t0 = performance.now();
    const result = generate(req);
    const ms = performance.now() - t0;
    const transfer = result.pieces.flatMap((p) => [p.positions.buffer, p.indices.buffer]);
    (self as unknown as Worker).postMessage({ id, ok: true, result, ms } satisfies WorkerResponse, transfer);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ id, ok: false, error } satisfies WorkerResponse);
  } finally {
    freeAll();
  }
};
