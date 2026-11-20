// Which address a rate-limit bucket belongs to, behind a proxy.
// Kept free of Express so the parsing can be unit-tested directly.
import net from 'net';

export interface AddressRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | null };
}

export interface ProxyTrust {
  trustProxy: boolean;
  // Number of reverse proxies in front of this server. Each one appends the address it
  // accepted the connection from to X-Forwarded-For, so the hop-th entry from the right
  // is the earliest address the chain can vouch for.
  trustedHops: number;
}

export const DEFAULT_TRUSTED_HOPS = 1;
export const MAX_TRUSTED_HOPS = 10;

export function parseTrustedHops(raw: string | undefined): number {
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1 || hops > MAX_TRUSTED_HOPS) return DEFAULT_TRUSTED_HOPS;
  return hops;
}

// Proxies normally write bare addresses; tolerate a bracketed IPv6 literal or a port.
function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return net.isIP(bracketed[1]) ? bracketed[1] : '';
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed);
  if (ipv4WithPort) return ipv4WithPort[1];
  return net.isIP(trimmed) ? trimmed : '';
}

export function clientAddress(req: AddressRequest, trust: ProxyTrust): string {
  const socketAddress = req.socket.remoteAddress || 'unknown';
  // Without a trusted proxy the header is just something the caller made up.
  if (!trust.trustProxy) return socketAddress;

  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : String(header || ''))
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  // More configured proxies than the chain shows: the chain cannot be read reliably,
  // so share the socket bucket rather than trust the caller's prefix.
  if (forwarded.length < trust.trustedHops) return socketAddress;

  // Never read from the left. The caller controls everything before the first address
  // that a trusted proxy appended, so count hop by hop from the right instead.
  const address = normalizeAddress(forwarded[forwarded.length - trust.trustedHops]);
  // Junk must not mint fresh buckets; a shared bucket fails closed.
  return address || socketAddress;
}
