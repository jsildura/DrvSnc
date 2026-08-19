import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  isTerminalStatus,
} from '../../src/shared/jobState';

describe('Upload Job State Machine', () => {
  describe('canTransition', () => {
    it('allows valid transitions according to state table', () => {
      // staging
      expect(canTransition('staging', 'queued')).toBe(true);
      expect(canTransition('staging', 'canceled')).toBe(true);
      expect(canTransition('staging', 'failed')).toBe(true);

      // queued
      expect(canTransition('queued', 'fetching')).toBe(true);
      expect(canTransition('queued', 'uploading')).toBe(true);
      expect(canTransition('queued', 'cancel_requested')).toBe(true);
      expect(canTransition('queued', 'failed')).toBe(true);

      // fetching
      expect(canTransition('fetching', 'uploading')).toBe(true);
      expect(canTransition('fetching', 'cancel_requested')).toBe(true);
      expect(canTransition('fetching', 'failed')).toBe(true);

      // uploading
      expect(canTransition('uploading', 'completed')).toBe(true);
      expect(canTransition('uploading', 'cancel_requested')).toBe(true);
      expect(canTransition('uploading', 'failed')).toBe(true);

      // cancel_requested
      expect(canTransition('cancel_requested', 'canceled')).toBe(true);
      expect(canTransition('cancel_requested', 'completed')).toBe(true);
      expect(canTransition('cancel_requested', 'failed')).toBe(true);

      // failed -> retry
      expect(canTransition('failed', 'queued')).toBe(true);
    });

    it('rejects invalid transitions', () => {
      expect(canTransition('staging', 'uploading')).toBe(false);
      expect(canTransition('staging', 'completed')).toBe(false);
      expect(canTransition('queued', 'completed')).toBe(false);
      expect(canTransition('completed', 'queued')).toBe(false);
      expect(canTransition('completed', 'failed')).toBe(false);
      expect(canTransition('canceled', 'queued')).toBe(false);
      expect(canTransition('failed', 'completed')).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('identifies completed, failed, and canceled as terminal', () => {
      expect(isTerminalStatus('completed')).toBe(true);
      expect(isTerminalStatus('failed')).toBe(true);
      expect(isTerminalStatus('canceled')).toBe(true);

      expect(isTerminalStatus('staging')).toBe(false);
      expect(isTerminalStatus('queued')).toBe(false);
      expect(isTerminalStatus('fetching')).toBe(false);
      expect(isTerminalStatus('uploading')).toBe(false);
      expect(isTerminalStatus('cancel_requested')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('throws when transition is illegal', () => {
      expect(() => assertTransition('completed', 'uploading')).toThrow();
      expect(() => assertTransition('canceled', 'staging')).toThrow();
    });

    it('does not throw on valid transition', () => {
      expect(() => assertTransition('queued', 'uploading')).not.toThrow();
    });
  });
});
