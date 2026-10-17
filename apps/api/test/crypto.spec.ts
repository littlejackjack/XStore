import {
  decryptSecret,
  encryptSecret,
  hmacSha256Hex,
  isEncrypted,
  maskSecret,
  safeEqual,
  sha256,
} from '../src/common/utils/crypto.util';

const MASTER_KEY = 'unit-test-encryption-key-32-chars-minimum';

describe('crypto.util', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret', () => {
      const envelope = encryptSecret('whsec_super_secret_value', MASTER_KEY);
      expect(decryptSecret(envelope, MASTER_KEY)).toBe('whsec_super_secret_value');
    });

    it('never stores the plain text', () => {
      const envelope = encryptSecret('marzban-password-123', MASTER_KEY);
      expect(envelope).not.toContain('marzban-password-123');
      expect(isEncrypted(envelope)).toBe(true);
    });

    it('produces different ciphertext for the same input (random salt+iv)', () => {
      const a = encryptSecret('same-value', MASTER_KEY);
      const b = encryptSecret('same-value', MASTER_KEY);
      expect(a).not.toEqual(b);
      expect(decryptSecret(a, MASTER_KEY)).toBe(decryptSecret(b, MASTER_KEY));
    });

    it('fails to decrypt with the wrong master key', () => {
      const envelope = encryptSecret('top-secret', MASTER_KEY);
      expect(() => decryptSecret(envelope, 'another-key-that-is-long-enough-32')).toThrow();
    });

    it('rejects tampered ciphertext (GCM auth tag)', () => {
      const envelope = JSON.parse(encryptSecret('integrity-check', MASTER_KEY));
      envelope.ct = Buffer.from('tampered-data!!').toString('base64');
      expect(() => decryptSecret(JSON.stringify(envelope), MASTER_KEY)).toThrow();
    });

    it('rejects non-envelope values', () => {
      expect(isEncrypted('plain-text-secret')).toBe(false);
      expect(() => decryptSecret('plain-text-secret', MASTER_KEY)).toThrow();
    });

    it('refuses to encrypt empty values', () => {
      expect(() => encryptSecret('', MASTER_KEY)).toThrow();
    });
  });

  describe('hmacSha256Hex', () => {
    it('matches the Bayar.gg signature scheme', () => {
      const signatureBase = 'BAYAR-123|paid|50000|1705312530';
      const expected = hmacSha256Hex(signatureBase, 'whsec_test');
      // Deterministic - the same base + secret always produce the same digest.
      expect(hmacSha256Hex(signatureBase, 'whsec_test')).toBe(expected);
      expect(expected).toMatch(/^[a-f0-9]{64}$/);
      expect(hmacSha256Hex(signatureBase, 'wrong-secret')).not.toBe(expected);
    });
  });

  describe('safeEqual', () => {
    it('compares equal and unequal values', () => {
      expect(safeEqual('abc', 'abc')).toBe(true);
      expect(safeEqual('abc', 'abd')).toBe(false);
      expect(safeEqual('abc', 'abcd')).toBe(false);
    });
  });

  describe('sha256', () => {
    it('hashes deterministically', () => {
      expect(sha256('refresh-token')).toBe(sha256('refresh-token'));
      expect(sha256('a')).not.toBe(sha256('b'));
    });
  });

  describe('maskSecret', () => {
    it('keeps only the last 4 characters', () => {
      expect(maskSecret('whsec_abcdef1234567890')).toMatch(/\*+7890$/);
      expect(maskSecret('short')).toBe('*hort');
      expect(maskSecret('')).toBe('');
    });
  });
});
