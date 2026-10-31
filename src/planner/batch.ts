import type { GenerateRequest, GenerateResult, GeometryOptions } from '../geometry/generate';
import { sanitize } from '../state';

export const GEOMETRY_VERSION = 'planner-b-1';
export const CACHE_LIMIT = 64 * 1024 * 1024;

export interface Job {
  req: GenerateRequest;
  options?: GeometryOptions;
  purpose: 'preview' | 'print';
}

export interface BatchRequest extends Job {
  type: 'generate';
  batchId: number;
  jobId: number;
  key: string;
}

export type BatchReply =
  | { type: 'result'; batchId: number; jobId: number; key: string; result: GenerateResult; ms: number }
  | { type: 'error'; batchId: number; jobId: number; key: string; error: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    return '{' + Object.keys(fields).sort().map(key => JSON.stringify(key) + ':' + canonical(fields[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function jobKey(job: Job): string {
  const request = sanitize(job.req);
  return canonical({
    version: GEOMETRY_VERSION,
    purpose: job.purpose,
    kind: request.kind,
    params: request[request.kind],
    print: request.print,
    options: job.options ?? {},
  });
}

export function resultBytes(result: GenerateResult): number {
  const buffers = new Set<ArrayBufferLike>();
  for (const piece of result.pieces) {
    buffers.add(piece.positions.buffer);
    buffers.add(piece.indices.buffer);
  }
  return [...buffers].reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
}

export class ResultCache {
  private pinned?: string;
  private entries = new Map<string, { result: GenerateResult; bytes: number }>();
  bytes = 0;

  constructor(readonly limit = CACHE_LIMIT) {}

  pin(key?: string): void {
    this.pinned = key;
  }

  get(key: string): GenerateResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(key: string, result: GenerateResult): boolean {
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
    }
    const bytes = resultBytes(result);
    if (bytes > this.limit) return false;
    while (this.bytes + bytes > this.limit) {
      const oldest = [...this.entries.keys()].find(candidate => candidate !== this.pinned);
      if (oldest === undefined) return false;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { result, bytes });
    this.bytes += bytes;
    return true;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }
}

export interface WorkerLike {
  postMessage(data: BatchRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<BatchReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: (() => void) | null;
}

export interface BatchCallbacks {
  progress: (completed: number, total: number) => void;
  updated: () => void;
  error: (key: string, message: string) => void;
}

function geometryWorker(): WorkerLike {
  return new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export class BatchQueue {
  readonly cache: ResultCache;
  private worker?: WorkerLike;
  private batchId = 0;
  private nextId = 0;
  private queue: { key: string; job: Job }[] = [];
  private active?: { key: string; id: number };
  private completed = 0;
  private total = 0;
  private callbacks?: BatchCallbacks;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(private factory = geometryWorker, cache = new ResultCache()) {
    this.cache = cache;
  }

  private create(): WorkerLike {
    const worker = this.factory();
    worker.onmessage = event => {
      if (worker !== this.worker) return;
      this.receive(event.data);
    };
    worker.onerror = event => {
      if (worker !== this.worker) return;
      event.preventDefault?.();
      this.fail('Geometry worker failed.');
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.fail('Could not read geometry worker reply.');
    };
    return worker;
  }

  private receive(reply: BatchReply): void {
    const active = this.active;
    if (!active || reply.batchId !== this.batchId || reply.jobId !== active.id || reply.key !== active.key) return;
    clearTimeout(this.timeout);
    if (reply.type === 'result') {
      if (!this.cache.set(reply.key, reply.result)) {
        this.callbacks?.error(reply.key, 'Preview does not fit in the cache budget; showing a footprint proxy.');
      }
    } else {
      this.callbacks?.error(reply.key, reply.error);
    }
    this.finishActive();
    this.pump();
  }

  private finishActive(): void {
    this.active = undefined;
    this.completed++;
    this.callbacks?.progress(this.completed, this.total);
    this.callbacks?.updated();
  }

  private fail(message: string): void {
    clearTimeout(this.timeout);
    if (this.active) this.callbacks?.error(this.active.key, message);
    this.worker?.terminate();
    this.worker = undefined;
    if (this.active) this.finishActive();
    this.pump();
  }

  start(jobs: Job[], callbacks: BatchCallbacks): number {
    this.cancel();
    this.callbacks = callbacks;
    const unique = new Map(jobs.map(input => {
      const job = { ...structuredClone(input), req: sanitize(input.req) };
      return [jobKey(job), job] as const;
    }));
    this.total = unique.size;
    this.completed = 0;
    for (const [key, job] of unique) {
      if (this.cache.has(key)) this.completed++;
      else this.queue.push({ key, job });
    }
    callbacks.progress(this.completed, this.total);
    callbacks.updated();
    this.pump();
    return this.batchId;
  }

  private pump(): void {
    if (this.active || !this.queue.length) return;
    const { key, job } = this.queue.shift()!;
    const id = ++this.nextId;
    this.active = { key, id };
    this.worker ??= this.create();
    this.worker.postMessage({ ...job, type: 'generate', batchId: this.batchId, jobId: id, key });
    this.timeout = setTimeout(() => this.fail('Geometry job timed out.'), 30_000);
  }

  cancel(): void {
    // A synchronous WASM job can only be interrupted by terminating its worker.
    this.batchId++;
    clearTimeout(this.timeout);
    this.queue = [];
    this.active = undefined;
    this.callbacks = undefined;
    this.worker?.terminate();
    this.worker = undefined;
  }

  dispose(): void {
    this.cancel();
  }
}
