import test from 'node:test';
import assert from 'node:assert/strict';

import { describeProviderFailure, providerErrorDetail } from '../lib/providerErrors.ts';

test('reads the reason out of an OpenAI-style error envelope', () => {
  const body = JSON.stringify({
    error: {
      message: 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash-1017. (request_id: 189cf086)',
      type: 'invalid_request_error',
      param: null,
      code: 'invalid_request_error',
    },
  });
  assert.equal(
    providerErrorDetail(body),
    'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash-1017. (request_id: 189cf086)'
  );
  assert.equal(
    describeProviderFailure(400, body),
    'AI provider error: 400 — The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash-1017. (request_id: 189cf086)'
  );
});

test('accepts a bare message, a nested detail and a list of validation errors', () => {
  assert.equal(providerErrorDetail('{"message":"Incorrect API key provided."}'), 'Incorrect API key provided.');
  assert.equal(providerErrorDetail('{"error":"Rate limit reached."}'), 'Rate limit reached.');
  assert.equal(
    providerErrorDetail('{"detail":[{"msg":"model is required"},{"msg":"base URL is required"}]}'),
    'model is required base URL is required'
  );
});

test('collapses a non-JSON body into one line of text', () => {
  assert.equal(providerErrorDetail('<html><body><h1>502 Bad Gateway</h1></body></html>'), '502 Bad Gateway');
  assert.equal(providerErrorDetail('  upstream   connect   error '), 'upstream connect error');
});

test('says so when the provider answered with nothing at all', () => {
  assert.equal(providerErrorDetail(''), '');
  assert.equal(describeProviderFailure(500, ''), 'AI provider error: 500 with no detail in the response.');
});

test('keeps a long provider message to one readable line', () => {
  const detail = providerErrorDetail(JSON.stringify({ error: { message: 'x'.repeat(900) } }));
  assert.equal(detail.length, 300);
  assert.ok(detail.endsWith('…'));
});
