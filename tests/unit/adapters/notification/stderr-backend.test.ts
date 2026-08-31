import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StderrBackend } from '../../../../src/adapters/notification/stderr-backend.js';
import { StderrCapture } from './_stderr-capture.js';

describe('StderrBackend', () => {
  it('is always available', async () => {
    await expect(new StderrBackend().isAvailable()).resolves.toBe(true);
  });

  it('never claims to support actions', () => {
    expect(new StderrBackend().supportsActions()).toBe(false);
  });

  describe('send', () => {
    let capture: StderrCapture;

    beforeEach(() => {
      capture = new StderrCapture();
      capture.install();
    });

    afterEach(() => {
      capture.restore();
    });

    it('writes the title and body to stderr and never throws', async () => {
      const backend = new StderrBackend();

      await expect(
        backend.send({ title: 'seeya end-day: 2026-08-16', body: '1 session captured.' }),
      ).resolves.toBeUndefined();

      expect(capture.writes).toHaveLength(1);
      expect(capture.writes[0]).toContain('seeya end-day: 2026-08-16');
      expect(capture.writes[0]).toContain('1 session captured.');
    });
  });
});
