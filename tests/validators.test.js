const { normalizeChannel, cleanText, isUserId } = require('../src/utils/validators');

describe('validators', () => {
  test('normalizeChannel lowercases and trims valid names', () => {
    expect(normalizeChannel(' General ')).toBe('general');
  });
  test('normalizeChannel rejects bad names', () => {
    expect(normalizeChannel('bad name!')).toBeNull();
    expect(normalizeChannel('a')).toBeNull();
    expect(normalizeChannel(42)).toBeNull();
  });
  test('cleanText trims, and rejects empty or oversized text', () => {
    expect(cleanText('  hi  ')).toBe('hi');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText('x'.repeat(5000))).toBeNull();
    expect(cleanText({ a: 1 })).toBeNull();
  });
  test('isUserId accepts only the u_ format', () => {
    expect(isUserId('u_alice')).toBe(true);
    expect(isUserId('alice')).toBe(false);
  });
});
