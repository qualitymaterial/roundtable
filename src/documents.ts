import { Worker } from 'node:worker_threads';
import { extname } from 'node:path';
import { z } from 'zod';

export const documentTypes = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export const extractionSchema = z.object({ text: z.string().max(64000), format: z.enum(['pdf', 'docx', 'pptx', 'xlsx']), parts: z.number().int().min(1).max(200), warnings: z.array(z.string().max(500)).max(10) });
export type Extraction = z.infer<typeof extractionSchema>;
export function documentMime(name: string): string | undefined { return documentTypes[extname(name).toLowerCase() as keyof typeof documentTypes]; }

/** Resource-limited parsing of explicit snapshots. Workers are not an OS sandbox. */
export async function extractDocument(name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<Extraction> {
  if (!documentMime(name)) throw new Error('Supported documents: PDF, DOCX, PPTX, XLSX');
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Document limit is 2 MiB');
  if (signal?.aborted) throw new Error('Document extraction cancelled');
  // npm test builds first; source and installed consumers use the same compiled worker.
  const url = new URL(import.meta.url.endsWith('.ts') ? '../dist/document-worker.js' : './document-worker.js', import.meta.url);
  const worker = new Worker(url, { workerData: { name, bytes }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 }, stdout: true, stderr: true, env: {}, execArgv: [] });
  worker.stdout.resume(); worker.stderr.resume();
  return new Promise<Extraction>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: Extraction) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate(); if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new Error('Document extraction cancelled'));
    const timer = setTimeout(() => finish(new Error('Document extraction exceeded 10 seconds')), 10000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('error', error => finish(error));
    worker.once('exit', () => finish(new Error('Document parser exited before completing')));
    worker.once('message', (value: unknown) => {
      const result = extractionSchema.safeParse(value);
      if (result.success) finish(undefined, result.data);
      else finish(new Error(typeof value === 'object' && value && 'error' in value ? String(value.error).slice(0, 500) : 'Invalid document extraction result'));
    });
  });
}
