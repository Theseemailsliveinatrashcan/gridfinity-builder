import { Zip, ZipDeflate, strToU8 } from 'fflate';
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_INPUT = 512 * 1024 * 1024;
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Drawer export cancelled.', 'AbortError');
}
export async function exportCheckpoint(signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  checkCancelled(signal);
}

/** Output chunks become Blob parts; discard them all when cancelled or capped. */
export class StreamingArchive {
  private zip: Zip;
  private chunks: BlobPart[] = [];
  private bytes = 0;
  private ended = false;
  private inputBytes = 0;
  constructor(private signal?: AbortSignal, private limit = MAX_ARCHIVE_BYTES, private inputLimit = MAX_ARCHIVE_INPUT) {
    this.zip = new Zip((error, chunk, final) => {
      if (error) throw error;
      checkCancelled(signal);
      this.bytes += chunk.byteLength;
      if (this.bytes > this.limit) throw new Error('Drawer archive exceeds the 256 MiB output limit. Reduce the layout.');
      this.chunks.push(chunk as BlobPart);
      this.ended = final;
    });
  }
  entry(name: string): ZipDeflate {
    checkCancelled(this.signal);
    const file = new ZipDeflate(name, { level: 6 });
    const push = file.push.bind(file);
    file.push = (chunk, final) => {
      checkCancelled(this.signal);
      this.inputBytes += chunk.byteLength;
      if (this.inputBytes > this.inputLimit) throw new Error('Drawer archive exceeds the 512 MiB uncompressed input limit. Reduce the layout.');
      push(chunk, final);
    };
    this.zip.add(file);
    return file;
  }
  text(name: string, text: string): void {
    this.entry(name).push(strToU8(text), true);
  }
  finish(type: string): Blob {
    checkCancelled(this.signal);
    this.zip.end();
    if (!this.ended) throw new Error('Drawer archive did not finish.');
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    return blob;
  }
  cancel(): void {
    this.zip.terminate();
    this.chunks = [];
  }
}
