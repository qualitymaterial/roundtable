import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { WebError } from './web-types.js';

const denied4 = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) denied4.addSubnet(ip, prefix);
const global6 = new BlockList(); global6.addSubnet('2000::', 3, 'ipv6');
const denied6 = new BlockList();
for (const [ip, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) denied6.addSubnet(ip, prefix, 'ipv6');
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) return !denied4.check(address);
  return isIP(address) === 6 && global6.check(address, 'ipv6') && !denied6.check(address, 'ipv6');
}
export function webUrl(raw: string, publicOnly = true): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new WebError('invalid_url', 'An absolute HTTP(S) URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port) && publicOnly)) throw new WebError('blocked_destination', 'Only HTTP(S) URLs on standard ports without credentials are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (publicOnly && (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !isIP(host) || isIP(host) && !publicAddress(host))) throw new WebError('blocked_destination', 'URL is not a public web destination');
  url.hash = ''; return url;
}
export type HttpReply = { status: number; headers: Record<string, string>; body: string };
export type WebTransport = (url: URL, signal: AbortSignal, headers?: Record<string, string>, publicOnly?: boolean) => Promise<HttpReply>;
export type AddressResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
// No proxies, cookies, redirects, ambient authentication or second DNS lookup.
export function createWebTransport(resolve: AddressResolver = host => lookup(host, { all: true, verbatim: true })): WebTransport {
  return async (input, signal, headers = {}, publicOnly = true) => {
    const url = webUrl(input.href, publicOnly); signal.throwIfAborted();
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let dnsAbort: () => void = () => {};
    let addresses: { address: string; family: number }[];
    try { addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([resolve(host), new Promise<never>((_, reject) => {
      dnsAbort = () => reject(signal.reason); if (signal.aborted) dnsAbort(); else signal.addEventListener('abort', dnsAbort, { once: true });
    })]); } finally { signal.removeEventListener('abort', dnsAbort); }
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !isIP(a.address) || publicOnly && !publicAddress(a.address))) throw new WebError('blocked_destination', 'DNS resolution includes a non-public address');
    const selected = addresses[0]!;
    return new Promise<HttpReply>((resolveReply, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: 'GET', signal, agent: false, family: selected.family, maxHeaderSize: 16384,
        headers: { Accept: 'text/html, text/plain, application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'Roundtable-Web/1', ...headers },
        lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
      }, response => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) { response.destroy(); reject(new WebError(status >= 300 && status < 400 ? 'redirect_denied' : status === 429 ? 'rate_limited' : 'provider_error', `Web service returned HTTP ${status}`)); return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new WebError('unsupported_encoding', 'Compressed responses are not accepted')); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) { response.destroy(); reject(new WebError('response_too_large', 'Web response exceeds 1 MiB')); } else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => resolveReply({ status, headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value ?? ''])), body: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject); request.end();
    });
  };
}
export const publicWebTransport = createWebTransport();
