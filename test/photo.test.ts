import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validAvatar, validPhoto, MAX_PHOTO_CHARS } from '../src/server/avatar.js';

test('player photos: only small jpeg/png/webp data URLs pass', () => {
  const ok = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  assert.equal(validPhoto(ok), true);
  assert.equal(validAvatar(ok), ok);
  assert.equal(validPhoto('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(validPhoto('data:image/webp;base64,UklGRg=='), true);
  assert.equal(validPhoto('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(validPhoto('data:image/gif;base64,R0lGOD=='), false);
  assert.equal(validPhoto('data:image/jpeg;base64,abc"><script>'), false);
  assert.equal(validPhoto('https://evil.example/x.jpg'), false);
  assert.equal(validPhoto('data:image/jpeg;base64,' + 'A'.repeat(MAX_PHOTO_CHARS)), false);
  assert.equal(validAvatar('data:text/html;base64,PGI+'), undefined);
  assert.equal(validAvatar('lion'), 'lion');
});
