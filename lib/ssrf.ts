// Outbound fetch hardening: only public http(s) hosts, re-checked on every redirect hop.
// Kept free of Express so it can be unit-tested directly.
import dns from 'dns';
import net from 'net';

export const MAX_REDIRECTS = 4;
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;

export class BlockedUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;              // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                         // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                // private 172.16/12
  if (a === 192 && b === 168) return true;                         // private 192.168/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;   // 192.0.0/24, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;            // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true;             // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;              // TEST-NET-3
  if (a >= 224) return true;                                       // multicast, reserved, broadcast
  return false;
}

export function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::' || addr === '::1') return true;
  if (addr.startsWith('::ffff:')) {
    const mapped = addr.slice('::ffff:'.length);
    return net.isIPv4(mapped) ? isBlockedIpv4(mapped) : true;
  }
  const firstGroup = addr.split(':')[0];
  if (firstGroup.startsWith('fc') || firstGroup.startsWith('fd')) return true; // unique-local fc00::/7
  if (/^fe[89ab]/.test(firstGroup)) return true;                               // link-local fe80::/10
  if (firstGroup.startsWith('ff')) return true;                                // multicast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http and https URLs are supported');
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URLs containing credentials are not supported');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new BlockedUrlError('URL is missing a host');
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new BlockedUrlError('Requests to local or internal hostnames are not allowed');
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new BlockedUrlError('Requests to internal network addresses are not allowed');
  }
  return url;
}

export type DnsAnswer = { address: string; family: number };

// Injectable so tests can answer with any address list instead of real DNS.
export type DnsResolver = (
  hostname: string,
  options: dns.LookupOptions & { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: DnsAnswer[]) => void,
) => void;

// Filter DNS answers at connect time so a host cannot resolve to a public IP first and an internal one later
export function createGuardedLookup(resolve: DnsResolver = dns.lookup as unknown as DnsResolver) {
  return (
    hostname: string,
    options: any,
    callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void,
  ) => {
    const lookupOptions = typeof options === 'number' ? { family: options } : { ...options };
    resolve(hostname, { ...lookupOptions, all: true } as dns.LookupOptions & { all: true }, (err, addresses) => {
      if (err) {
        callback(err);
        return;
      }
      const safe = addresses.filter(entry => !isBlockedAddress(entry.address));
      if (safe.length === 0) {
        callback(new BlockedUrlError('Host resolves to an internal network address'));
        return;
      }
      if (lookupOptions.all) {
        callback(null, safe);
        return;
      }
      callback(null, safe[0].address, safe[0].family);
    });
  };
}

export const guardedLookup = createGuardedLookup();
