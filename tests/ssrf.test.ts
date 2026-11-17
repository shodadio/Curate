import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';

import {
  BlockedUrlError,
  assertPublicHttpUrl,
  createGuardedLookup,
  guardedLookup,
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
} from '../lib/ssrf.ts';

test('isBlockedIpv4 blocks every non-public range the app promises to refuse', () => {
  const blocked = [
    '0.0.0.0',        // "this" network
    '10.1.2.3',       // private /8
    '127.0.0.1',      // loopback
    '127.1.2.3',      // loopback, not just .0.1
    '100.64.0.1',     // CGNAT
    '100.127.255.255',// CGNAT upper bound
    '169.254.169.254',// link-local / cloud metadata
    '172.16.0.1',     // private /12 lower bound
    '172.31.255.255', // private /12 upper bound
    '192.168.1.1',    // private /16
    '192.0.0.8',      // 192.0.0/24
    '192.0.2.5',      // TEST-NET-1
    '198.18.0.1',     // benchmarking
    '198.19.255.255', // benchmarking upper bound
    '198.51.100.7',   // TEST-NET-2
    '203.0.113.9',    // TEST-NET-3
    '224.0.0.1',      // multicast
    '255.255.255.255',// broadcast
  ];
  for (const ip of blocked) {
    assert.equal(isBlockedIpv4(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedIpv4 allows ordinary public addresses', () => {
  const allowed = [
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.15.255.255', // just below the private /12
    '172.32.0.1',     // just above the private /12
    '11.0.0.1',       // just outside 10/8
    '192.167.1.1',    // just outside 192.168/16
    '100.63.255.255', // just below CGNAT
    '100.128.0.1',    // just above CGNAT
    '169.253.1.1',
  ];
  for (const ip of allowed) {
    assert.equal(isBlockedIpv4(ip), false, `${ip} should be allowed`);
  }
});

test('isBlockedIpv4 treats anything malformed as blocked', () => {
  for (const ip of ['256.0.0.1', '1.2.3', '1.2.3.4.5', '1.2.3.x']) {
    assert.equal(isBlockedIpv4(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedIpv6 covers loopback, unique-local, link-local, multicast and mapped v4', () => {
  const blocked = [
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
  ];
  for (const ip of blocked) {
    assert.equal(isBlockedIpv6(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedIpv6 allows public addresses, including a mapped public v4', () => {
  for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedIpv6(ip), false, `${ip} should be allowed`);
  }
});

test('isBlockedAddress fails closed for non-IP input', () => {
  assert.equal(isBlockedAddress('example.com'), true);
  assert.equal(isBlockedAddress('not-an-ip'), true);
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('2001:4860:4860::8888'), false);
});

test('assertPublicHttpUrl accepts ordinary public URLs', async () => {
  for (const url of [
    'https://example.com/feed.xml',
    'http://marginalrevolution.com/feed',
    'https://8.8.8.8/dns-query',
    'https://sub.example.co.uk/a/b?c=d#e',
  ]) {
    const parsed = await assertPublicHttpUrl(url);
    assert.ok(parsed instanceof URL, `${url} should parse`);
  }
});

test('assertPublicHttpUrl refuses non-http protocols', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com', 'data:text/plain,hi', 'ws://example.com']) {
    await assert.rejects(assertPublicHttpUrl(url), BlockedUrlError, `${url} should be blocked`);
  }
});

test('assertPublicHttpUrl refuses embedded credentials', async () => {
  await assert.rejects(assertPublicHttpUrl('https://user:pass@example.com/feed'), BlockedUrlError);
  await assert.rejects(assertPublicHttpUrl('https://user@example.com/feed'), BlockedUrlError);
});

test('assertPublicHttpUrl refuses local and internal hostnames', async () => {
  const blocked = [
    'http://localhost:3000/',
    'http://LOCALHOST/',
    'http://app.localhost/',
    'http://printer.local/',
    'http://service.internal/',
    'http://router.home.arpa/',
    'http://metadata.google.internal/computeMetadata/v1/',
  ];
  for (const url of blocked) {
    await assert.rejects(assertPublicHttpUrl(url), BlockedUrlError, `${url} should be blocked`);
  }
});

test('assertPublicHttpUrl refuses internal IP literals, including bracketed IPv6', async () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
  ];
  for (const url of blocked) {
    await assert.rejects(assertPublicHttpUrl(url), BlockedUrlError, `${url} should be blocked`);
  }
});

test('assertPublicHttpUrl rejects unparsable input instead of throwing a raw TypeError', async () => {
  for (const url of ['', 'not a url', 'http://']) {
    await assert.rejects(assertPublicHttpUrl(url), BlockedUrlError);
  }
});

test('guardedLookup hands back only public answers', () => {
  const lookup = createGuardedLookup((_hostname, _options, callback) => {
    callback(null, [
      { address: '10.0.0.7', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
  });
  const result = new Promise<{ address: string; family: number }>((resolve, reject) => {
    lookup('example.com', {}, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address: String(address), family: family ?? 0 });
    });
  });
  return result.then(value => assert.deepEqual(value, { address: '93.184.216.34', family: 4 }));
});

test('guardedLookup refuses a host that resolves only to internal addresses', () => {
  const lookup = createGuardedLookup((_hostname, _options, callback) => {
    callback(null, [{ address: '169.254.169.254', family: 4 }]);
  });
  const result = new Promise<Error>((resolve, reject) => {
    lookup('rebind.example', {}, err => {
      if (err) resolve(err);
      else reject(new Error('expected the lookup to be refused'));
    });
  });
  return result.then(err => assert.ok(err instanceof BlockedUrlError));
});

test('guardedLookup passes every public address through when the caller asked for all', () => {
  const lookup = createGuardedLookup((_hostname, _options, callback) => {
    callback(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });
  const result = new Promise<Array<{ address: string }>>((resolve, reject) => {
    lookup('example.com', { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
  return result.then(addresses =>
    assert.deepEqual(addresses.map(entry => entry.address), ['93.184.216.34', '2606:4700:4700::1111'])
  );
});

test('guardedLookup forwards resolver errors untouched', () => {
  const lookup = createGuardedLookup((_hostname, _options, callback) => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND missing.example'), { code: 'ENOTFOUND' });
    callback(error, []);
  });
  const result = new Promise<NodeJS.ErrnoException>((resolve, reject) => {
    lookup('missing.example', {}, err => {
      if (err) resolve(err);
      else reject(new Error('expected the resolver error to surface'));
    });
  });
  return result.then(err => assert.equal(err.code, 'ENOTFOUND'));
});

test('the production guardedLookup is built on the real resolver', () => {
  assert.equal(typeof guardedLookup, 'function');
  assert.equal(guardedLookup.length, 3);
  // Real DNS, loopback literal: the guard must refuse without any network access.
  const result = new Promise<Error>((resolve, reject) => {
    guardedLookup('localhost', {}, err => {
      if (err) resolve(err);
      else reject(new Error('localhost must not resolve through the guard'));
    });
  });
  return result.then(err => {
    const code = (err as NodeJS.ErrnoException).code;
    assert.ok(err instanceof BlockedUrlError || code === 'ENOTFOUND' || code === 'EAI_AGAIN', `unexpected error: ${err.message}`);
  });
});

test('assertPublicHttpUrl leaves the URL object usable for the fetch that follows', async () => {
  const url = await assertPublicHttpUrl('https://Example.com:8443/feed.xml?x=1#frag');
  assert.equal(url.hostname, 'example.com');
  assert.equal(url.port, '8443');
  assert.equal(url.pathname, '/feed.xml');
  assert.equal(url.search, '?x=1');
});

test('dns is never consulted for IP-literal or blocked-hostname URLs', async () => {
  const dnsModule = dns as any;
  const original = dnsModule.lookup;
  let calls = 0;
  dnsModule.lookup = (...args: any[]) => { calls += 1; return original.apply(dnsModule, args); };
  try {
    await assert.rejects(assertPublicHttpUrl('http://127.0.0.1/'), BlockedUrlError);
    await assert.rejects(assertPublicHttpUrl('http://localhost/'), BlockedUrlError);
    assert.equal(calls, 0, 'a rejected literal must not reach DNS');
  } finally {
    dnsModule.lookup = original;
  }
});
