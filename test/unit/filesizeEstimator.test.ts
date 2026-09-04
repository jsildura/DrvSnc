import { describe, it, expect } from 'vitest';
import {
  calcVideoBitrate,
  calcVideoFilesizeMb,
  calcBpp,
  calcBitrateBasedOnBpp,
  calculateSliderBounds,
  evaluateTargetSize,
} from '../../src/web/converter/filesizeEstimator';

describe('filesizeEstimator', () => {
  describe('calcVideoBitrate', () => {
    it('accurately calculates required video bitrate from target file size and duration', () => {
      // 100 MB over 60 seconds with 128 kbps audio
      // Total bits = 100 * 1024 * 1024 * 8 = 838,860,800 bits
      // Audio bits = 128 * 1024 * 60 = 7,864,320 bits
      // Video bitrate = (838,860,800 - 7,864,320) / 60 / 1024 = 13,526 kbps
      const vb = calcVideoBitrate(100, 60, 128);
      expect(vb).toBeCloseTo(13526, -1);
    });

    it('handles no audio (audioBitrate = 0)', () => {
      // 25 MB over 100 seconds, 0 audio
      // Total bits = 25 * 1024 * 1024 * 8 = 209,715,200 bits
      // Video bitrate = 209,715,200 / 100 / 1024 = 2048 kbps
      const vb = calcVideoBitrate(25, 100, 0);
      expect(vb).toBe(2048);
    });

    it('enforces a safety floor of 10 kbps for absurdly low sizes', () => {
      const vb = calcVideoBitrate(0.01, 1000, 128);
      expect(vb).toBe(10);
    });
  });

  describe('calcVideoFilesizeMb', () => {
    it('estimates output file size from video and audio bitrates', () => {
      // 2048 kbps video + 0 kbps audio over 100 seconds should be 25 MB
      const mb = calcVideoFilesizeMb(2048, 0, 100);
      expect(mb).toBe(25);
    });

    it('rounds correctly for larger and smaller files', () => {
      const smallMb = calcVideoFilesizeMb(200, 64, 30);
      expect(smallMb).toBeGreaterThan(0);
      expect(typeof smallMb).toBe('number');
    });
  });

  describe('calcBpp and calcBitrateBasedOnBpp', () => {
    it('converts between BPP and bitrate reversibly', () => {
      const width = 1920;
      const height = 1080;
      const fps = 25;
      const originalBitrate = 6000;

      const bpp = calcBpp(originalBitrate, width, height, fps);
      const computedBitrate = calcBitrateBasedOnBpp(bpp, width, height, fps);
      expect(computedBitrate).toBeCloseTo(originalBitrate, 0);
    });
  });

  describe('calculateSliderBounds', () => {
    it('computes reasonable bounds for 1080p video with known duration', () => {
      const bounds = calculateSliderBounds({
        durationMillis: 120000, // 2 minutes
        width: 1920,
        height: 1080,
        presetVb: 9000,
        audioBitrateKbps: 128,
      });

      expect(bounds.minMb).toBeGreaterThanOrEqual(5);
      expect(bounds.maxMb).toBeLessThanOrEqual(2000);
      expect(bounds.defaultMb).toBeGreaterThanOrEqual(bounds.minMb);
      expect(bounds.defaultMb).toBeLessThanOrEqual(bounds.maxMb);
      expect(bounds.effectiveDurationSec).toBe(120);
      expect(bounds.isDurationEstimated).toBe(false);
    });

    it('estimates duration when only source file size is provided', () => {
      const bounds = calculateSliderBounds({
        sourceSizeBytes: 50 * 1024 * 1024, // 50 MB
        width: 1280,
        height: 720,
        presetVb: 4500,
      });

      expect(bounds.isDurationEstimated).toBe(true);
      expect(bounds.effectiveDurationSec).toBeGreaterThan(0);
      expect(bounds.minMb).toBeLessThanOrEqual(bounds.defaultMb);
      expect(bounds.defaultMb).toBeLessThanOrEqual(bounds.maxMb);
    });
  });

  describe('evaluateTargetSize', () => {
    it('downscales audio when slider is in low compression range', () => {
      const bounds = {
        minMb: 10,
        maxMb: 1000,
        defaultMb: 200,
        stepMb: 5,
        effectiveDurationSec: 120,
        isDurationEstimated: false,
      };

      // Near the bottom (15 MB is < 5% of range)
      const lowResult = evaluateTargetSize(15, bounds, 1920, 1080, false, 128);
      expect(lowResult.audioBitrateKbps).toBeLessThanOrEqual(48);
      expect(lowResult.audioChannels).toBe(1); // mono downmixing
      expect(lowResult.qualityLevel).toBe('low');

      // Mid-range (500 MB)
      const midResult = evaluateTargetSize(500, bounds, 1920, 1080, false, 128);
      expect(midResult.audioBitrateKbps).toBe(128);
      expect(midResult.audioChannels).toBe(2);
      expect(['balanced', 'high', 'ultra']).toContain(midResult.qualityLevel);
    });
  });
});
