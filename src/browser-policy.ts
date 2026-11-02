import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { z } from 'zod';

export function localBaseUrl(raw: string): string {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('Browser sessions require an explicit literal-loopback model endpoint');
  return u.href.replace(/\/$/, '');
}
export const BrowserLocalPolicy = z.object({ models: z.array(z.object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(500), baseUrl: z.string().max(2000).transform(localBaseUrl) }).strict()).max(32) }).strict().refine(p => new Set(p.models.map(m => `${m.provider}\0${m.model}`)).size === p.models.length, 'Duplicate local model pin');
export type BrowserPolicy = z.output<typeof BrowserLocalPolicy>;
export const browserPolicyHash = (policy: BrowserPolicy) => createHash('sha256').update(JSON.stringify(policy)).digest('hex');
export const browserCapabilities = new Set(['collaborate', 'memory', 'artifact', 'browser.read']);
// Some existing collaborate tools execute separately approved host/sandbox work. Keep this prototype's surface explicit.
export const browserTools = new Set(['browser.read', 'browser.sources', 'roundtable_wait', 'roundtable_agents_list', 'roundtable_send', 'roundtable_threads_list', 'roundtable_thread_read', 'roundtable_task_create', 'roundtable_task_claim', 'roundtable_task_update', 'roundtable_tasks_list', 'roundtable_reference_resolve', 'roundtable_tools_list', 'roundtable_tool_request', 'roundtable_artifact_publish', 'roundtable_artifact_read', 'roundtable_artifact_validate_json', 'roundtable_evidence_add', 'roundtable_evidence_list', 'roundtable_memory_write', 'roundtable_memory_search', 'roundtable_session_status', 'data_json_validate']);
export function browserModelPin(policy: BrowserPolicy, provider: string, model: string) {
  const pin = policy.models.find(p => p.provider === provider && p.model === model);
  if (!pin) throw new Error('Model is not pinned to this local-only browser session; create a new browser session after configuring a local endpoint');
  return pin;
}
export function assertBrowserModel(policy: BrowserPolicy, model: { provider: string; id: string; baseUrl: string; api: string }): string {
  const pin = browserModelPin(policy, model.provider, model.id);
  if (model.api !== 'openai-completions' || localBaseUrl(model.baseUrl) !== pin.baseUrl) throw new Error('Browser model endpoint changed or is not a pinned local OpenAI-compatible endpoint');
  return pin.baseUrl;
}

/** Direct HTTP(S), no environment proxy, redirects, cookies or automatic destination changes. */
export function localModelFetch(baseUrl: string): typeof fetch {
  const base = new URL(localBaseUrl(baseUrl));
  return async (input, init) => {
    if (input instanceof Request) throw new Error('Local model transport requires an explicit URL and JSON request');
    const url = new URL(String(input));
    const prefix = base.pathname.replace(/\/$/, '');
    if (url.origin !== base.origin || (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) || url.username || url.password || url.hash) throw new Error('Local model attempted an unpinned destination');
    if (init?.body != null && typeof init.body !== 'string') throw new Error('Local model transport accepts JSON text requests only');
    const signal = init?.signal;
    signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: init?.method ?? 'GET', headers }, response => {
        const status = response.statusCode ?? 500;
        if (status >= 300 && status < 400) { response.destroy(); reject(new Error('Local model redirects are blocked')); return; }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      });
      const abort = () => req.destroy(new Error('Local model request cancelled'));
      signal?.addEventListener('abort', abort, { once: true });
      req.once('error', reject);
      req.once('close', () => signal?.removeEventListener('abort', abort));
      req.setTimeout(60000, () => req.destroy(new Error('Local model transport timed out')));
      req.end(init?.body ?? undefined);
    });
  };
}
