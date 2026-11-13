import { escapeHtml, b64EncodeUtf8, b64DecodeUtf8 } from '../modules/utils.js';

describe('Utility functions', () => {
  test('escapeHtml escapes special characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('Base64 encode and decode works correctly with UTF-8', () => {
    const original = 'Test string with accents éàù';
    const encoded = b64EncodeUtf8(original);
    const decoded = b64DecodeUtf8(encoded);
    expect(decoded).toBe(original);
  });
});
