import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clientAddress,
  parseTrustedHops,
  DEFAULT_TRUSTED_HOPS,
  MAX_TRUSTED_HOPS,
  type AddressRequest,
  type ProxyTrust,
} from '../lib/clientAddress.ts';

const ONE_PROXY: ProxyTrust = { trustProxy: true, trustedHops: 1 };
const TWO_PROXIES: ProxyTrust = { trustProxy: true, trustedHops: 2 };

function request(header?: string | string[], socket = '10.0.0.1'): AddressRequest {
  const headers: Record<string, string | string[]> = {};
  if (header !== undefined) headers['x-forwarded-for'] = header;
  return { headers, socket: { remoteAddress: socket } };
}

test('a forged prefix cannot change the bucket', () => {
  assert.equal(clientAddress(request('1.1.1.1, 203.0.113.7'), ONE_PROXY), '203.0.113.7');
  assert.equal(clientAddress(request('9.9.9.9, 203.0.113.7'), ONE_PROXY), '203.0.113.7');
});

test('visitors keep separate buckets', () => {
  assert.notEqual(
    clientAddress(request('203.0.113.7'), ONE_PROXY),
    clientAddress(request('203.0.113.8'), ONE_PROXY),
  );
});

test('a second trusted proxy is one more hop from the right', () => {
  assert.equal(
    clientAddress(request('198.51.100.4, 203.0.113.9, 10.0.0.5'), TWO_PROXIES),
    '203.0.113.9',
  );
});

test('the header is ignored without a trusted proxy', () => {
  assert.equal(clientAddress(request('203.0.113.7', '10.0.0.2'), { trustProxy: false, trustedHops: 1 }), '10.0.0.2');
});

test('a missing or unusable header falls back to the socket address', () => {
  assert.equal(clientAddress(request(undefined), ONE_PROXY), '10.0.0.1');
  assert.equal(clientAddress(request('unknown'), ONE_PROXY), '10.0.0.1');
  assert.equal(clientAddress(request('not-an-ip, not-an-ip'), ONE_PROXY), '10.0.0.1');
});

test('a chain shorter than the configured proxies falls back instead of trusting the left', () => {
  assert.equal(clientAddress(request('1.2.3.4'), TWO_PROXIES), '10.0.0.1');
});

test('bracketed IPv6 and address-with-port forms are normalised', () => {
  assert.equal(clientAddress(request('[2001:db8::1]:443'), ONE_PROXY), '2001:db8::1');
  assert.equal(clientAddress(request('203.0.113.7:5555'), ONE_PROXY), '203.0.113.7');
});

test('hop parsing keeps a sane value', () => {
  assert.equal(parseTrustedHops(undefined), DEFAULT_TRUSTED_HOPS);
  assert.equal(parseTrustedHops('2'), 2);
  assert.equal(parseTrustedHops('0'), DEFAULT_TRUSTED_HOPS);
  assert.equal(parseTrustedHops('99'), DEFAULT_TRUSTED_HOPS);
  assert.equal(parseTrustedHops('two'), DEFAULT_TRUSTED_HOPS);
  assert.ok(MAX_TRUSTED_HOPS >= 2);
});
