import axios, { type AxiosResponse } from 'axios';
import dns from 'node:dns';
import net from 'node:net';
import type { SafeWebFetchRawResult } from './safe-web-fetch.helpers.types';

export type { SafeWebFetchRawResult } from './safe-web-fetch.helpers.types';

const BLOCKED_HOSTNAMES = new Set(['localhost']);

const PRIVATE_IPV4_RANGES: Array<{ base: number; mask: number }> = [
  // Loopback: 127.0.0.0/8
  { base: ipv4ToInt('127.0.0.0'), mask: prefixToMask(8) },
  // Private: 10.0.0.0/8
  { base: ipv4ToInt('10.0.0.0'), mask: prefixToMask(8) },
  // Private: 172.16.0.0/12
  { base: ipv4ToInt('172.16.0.0'), mask: prefixToMask(12) },
  // Private: 192.168.0.0/16
  { base: ipv4ToInt('192.168.0.0'), mask: prefixToMask(16) },
  // Link-local: 169.254.0.0/16
  { base: ipv4ToInt('169.254.0.0'), mask: prefixToMask(16) },
];

type AxiosWebResponse = Omit<AxiosResponse<string>, 'request'> & {
  request?: {
    res?: {
      responseUrl?: unknown;
    };
  };
};

function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
}

function ipv4ToInt(ip: string): number {
  return (
    ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) | Number.parseInt(octet, 10), 0) >>> 0
  );
}

function isPrivateIPv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(
    ({ base, mask }) => (int & mask) === (base & mask),
  );
}

function isPrivateIPv6(ip: string): boolean {
  if (ip === '::1') return true;

  const normalized = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return (
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function getFinalUrl(response: AxiosWebResponse, fallbackUrl: string): string {
  const request = response.request;
  const responseUrl = request?.res?.responseUrl;
  return typeof responseUrl === 'string' ? responseUrl : fallbackUrl;
}

export async function assertNotPrivateHost(url: string): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');

  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error(`SSRF protection: hostname "${hostname}" is not allowed`);
  }

  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) {
      throw new Error(
        `SSRF protection: IP address "${hostname}" is in a private/reserved range`,
      );
    }

    if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) {
      throw new Error(
        `SSRF protection: IP address "${hostname}" is in a private/reserved range`,
      );
    }

    return;
  }

  const { address, family } = await dns.promises.lookup(hostname);

  if (family === 4 && isPrivateIPv4(address)) {
    throw new Error(
      `SSRF protection: "${hostname}" resolves to private IP "${address}"`,
    );
  }

  if (family === 6 && isPrivateIPv6(address)) {
    throw new Error(
      `SSRF protection: "${hostname}" resolves to private IP "${address}"`,
    );
  }
}

export async function fetchRawWebContent(
  url: string,
  timeoutMs: number,
): Promise<SafeWebFetchRawResult> {
  const response = await axios.get<string>(url, {
    timeout: timeoutMs,
    responseType: 'text',
    maxRedirects: 5,
  });
  const normalizedResponse = response as AxiosWebResponse;

  return {
    status: normalizedResponse.status,
    contentType:
      typeof normalizedResponse.headers['content-type'] === 'string'
        ? normalizedResponse.headers['content-type']
        : 'text/plain',
    body: normalizedResponse.data,
    finalUrl: getFinalUrl(normalizedResponse, url),
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}
