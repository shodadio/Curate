import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeModelCatalog } from '../lib/modelCatalog.ts';

test('OpenRouter models sort by live input and output prices, with free choices first', () => {
  const models = normalizeModelCatalog([
    { id: 'vendor/expensive', pricing: { prompt: '0.00001', completion: '0.00002' }, endpoints: ['/api/v1/chat/completions'] },
    { id: 'vendor/free', pricing: { prompt: '0', completion: '0' }, endpoints: ['/api/v1/chat/completions'] },
    { id: 'vendor/cheap', pricing: { prompt: '0.0000001', completion: '0.0000002' }, endpoints: ['/api/v1/chat/completions'] },
  ], { openRouter: true, kind: 'chat' });

  assert.deepEqual(models.map(model => model.id), ['vendor/free', 'vendor/cheap', 'vendor/expensive']);
  assert.ok(Math.abs(models[1].promptPerMillion! - 0.1) < 1e-10);
  assert.ok(Math.abs(models[1].completionPerMillion! - 0.2) < 1e-10);
});

test('OpenRouter chat picker excludes models without a chat-completions endpoint', () => {
  const models = normalizeModelCatalog([
    { id: 'vendor/batch-only', pricing: { prompt: '0', completion: '0' }, endpoints: ['/api/v1/batches'] },
    { id: 'vendor/chat', pricing: { prompt: '0.000001', completion: '0.000001' }, endpoints: ['/api/v1/chat/completions'] },
  ], { openRouter: true, kind: 'chat' });

  assert.deepEqual(models.map(model => model.id), ['vendor/chat']);
});

test('OpenRouter embedding picker uses embedding endpoints and keeps ID-only provider catalogs compatible', () => {
  const embeddings = normalizeModelCatalog([
    { id: 'vendor/chat', endpoints: ['/api/v1/chat/completions'] },
    { id: 'vendor/embed', endpoints: ['/api/v1/embeddings'] },
  ], { openRouter: true, kind: 'embedding' });
  const compatible = normalizeModelCatalog(['z-model', 'a-model']);

  assert.deepEqual(embeddings.map(model => model.id), ['vendor/embed']);
  assert.deepEqual(compatible.map(model => model.id), ['a-model', 'z-model']);
});
