import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const browserFrameLimit = 128 * 1024;
export const BrowserSnapshot = z.object({ type: z.literal('snapshot'), tabId: z.number().int().nonnegative(), documentId: z.string().min(1).max(100), url: z.string().min(1).max(4000), title: z.string().max(500), text: z.string().max(16000), truncated: z.boolean() }).strict();
export type BrowserPage = z.output<typeof BrowserSnapshot>;
export const BrowserRoute = z.object({ protocol: z.literal(1), sessionId: z.string().uuid(), instance: z.string().uuid(), endpoint: z.string().min(1).max(300), key: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function browserProof(key: string, value: string): string { return createHmac('sha256', key).update(value).digest('hex'); }
export function sameProof(expected: string, actual: unknown): boolean { return typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex')); }
export function encodeBrowserFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > browserFrameLimit) throw new Error('Browser frame exceeds size limit');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header, body]);
}
export class BrowserFrames {
  private pending: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    if (this.pending.length + chunk.length > browserFrameLimit * 2 + 8) throw new Error('Browser input buffer exceeds size limit');
    this.pending = Buffer.concat([this.pending, chunk]); const frames: unknown[] = [];
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE(0);
      if (!length || length > browserFrameLimit) throw new Error('Invalid browser frame size');
      if (this.pending.length < length + 4) break;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending.subarray(4, length + 4));
      frames.push(JSON.parse(text)); this.pending = this.pending.subarray(length + 4);
      if (frames.length > 32) throw new Error('Too many browser frames');
    }
    return frames;
  }
}
