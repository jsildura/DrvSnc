/**
 * Utility functions for video output file size estimation and bitrate calculations.
 * Mirrors the exact encoding formulas used by video-converter.com (123apps).
 */

export interface SliderBounds {
  minMb: number;
  maxMb: number;
  defaultMb: number;
  stepMb: number;
  effectiveDurationSec: number;
  isDurationEstimated: boolean;
}

export interface BitrateCalculationResult {
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  audioChannels: number;
  qualityLevel: 'low' | 'balanced' | 'high' | 'ultra';
  bpp: number;
}

/**
 * Calculates Bits Per Pixel (BPP) for quality assessment.
 * Baseline assumption: 25 fps.
 */
export function calcBpp(
  bitrateKbps: number,
  width: number = 1280,
  height: number = 720,
  fps: number = 25
): number {
  if (!width || !height || !fps) return 0.1;
  return (1024 * bitrateKbps) / (width * height * fps);
}

/**
 * Calculates required bitrate based on a target Bits Per Pixel (BPP).
 */
export function calcBitrateBasedOnBpp(
  bpp: number,
  width: number = 1280,
  height: number = 720,
  fps: number = 25
): number {
  return Math.round((bpp * width * height * fps) / 1024);
}

/**
 * Calculates target video bitrate (in kbps) required to hit a target file size in MB.
 *
 * Formula:
 * Total Bits = targetMb * 1024 * 1024 * 8
 * Audio Bits = audioBitrateKbps * 1024 * durationSec
 * Video Bitrate (kbps) = (Total Bits - Audio Bits) / durationSec / 1024
 */
export function calcVideoBitrate(
  targetMb: number,
  durationSec: number,
  audioBitrateKbps: number = 128
): number {
  if (durationSec <= 0) durationSec = 60; // fallback 1 min
  const totalBits = targetMb * 1024 * 1024 * 8;
  const audioBits = audioBitrateKbps * 1024 * durationSec;
  const remainingBitsForVideo = totalBits - audioBits;
  const computedVb = Math.round(remainingBitsForVideo / durationSec / 1024);
  return Math.max(10, computedVb); // safety floor of 10 kbps
}

/**
 * Calculates estimated output file size in MB given video and audio bitrates.
 */
export function calcVideoFilesizeMb(
  videoBitrateKbps: number,
  audioBitrateKbps: number = 128,
  durationSec: number = 60
): number {
  if (durationSec <= 0) durationSec = 60;
  const totalKbps = Math.max(10, videoBitrateKbps) + Math.max(0, audioBitrateKbps);
  const sizeMb = (totalKbps * 1024 * durationSec) / (8 * 1024 * 1024);
  return sizeMb >= 10 ? Math.round(sizeMb) : Math.round(sizeMb * 10) / 10;
}

/**
 * Dynamically computes slider bounds (min, max, default) based on video metadata and resolution preset.
 */
export function calculateSliderBounds(params: {
  sourceSizeBytes?: number;
  durationMillis?: number;
  width?: number;
  height?: number;
  presetVb?: number;
  noAudio?: boolean;
  audioBitrateKbps?: number;
}): SliderBounds {
  const {
    sourceSizeBytes,
    durationMillis,
    presetVb = 4500,
    noAudio = false,
    audioBitrateKbps = 128,
  } = params;

  let width = params.width || 1280;
  let height = params.height || 720;
  if (width <= 0) width = 1280;
  if (height <= 0) height = 720;

  const audioBitrate = noAudio ? 0 : audioBitrateKbps;

  let effectiveDurationSec = 0;
  let isDurationEstimated = false;

  if (durationMillis && durationMillis > 0) {
    effectiveDurationSec = Math.max(1, Math.round(durationMillis / 1000));
  } else if (sourceSizeBytes && sourceSizeBytes > 0) {
    // Estimate duration assuming source average bitrate is ~4.5 Mbps
    isDurationEstimated = true;
    effectiveDurationSec = Math.max(10, Math.round((sourceSizeBytes * 8) / (4500 * 1024)));
  } else {
    isDurationEstimated = true;
    effectiveDurationSec = 60; // 1 minute default assumption
  }

  // Calculate lower bound: minimum tolerable quality (0.04 BPP)
  const minQualityBpp = 0.035;
  const minVb = Math.max(150, calcBitrateBasedOnBpp(minQualityBpp, width, height));
  const rawMinMb = calcVideoFilesizeMb(minVb, Math.min(64, audioBitrate), effectiveDurationSec);
  const minMb = Math.max(5, Math.min(rawMinMb, 50));

  // Upper bound: High quality (up to 2000 MB max or high BPP)
  const highQualityBpp = 0.25;
  const maxVb = Math.min(25000, calcBitrateBasedOnBpp(highQualityBpp, width, height));
  const rawMaxMb = calcVideoFilesizeMb(maxVb, audioBitrate, effectiveDurationSec);
  const maxMb = Math.min(2000, Math.max(minMb + 20, Math.round(rawMaxMb)));

  // Default optimal value
  let defaultMb = calcVideoFilesizeMb(presetVb, audioBitrate, effectiveDurationSec);
  if (sourceSizeBytes && sourceSizeBytes > 0) {
    const sourceMb = Math.round(sourceSizeBytes / (1024 * 1024));
    if (sourceMb > minMb && sourceMb < maxMb) {
      defaultMb = sourceMb;
    }
  }

  // Ensure defaultMb is within [minMb, maxMb]
  defaultMb = Math.max(minMb, Math.min(maxMb, defaultMb));

  // Step size: 1 MB for small files, 5 MB or 10 MB for larger files
  const stepMb = maxMb > 500 ? 5 : 1;

  return {
    minMb,
    maxMb,
    defaultMb,
    stepMb,
    effectiveDurationSec,
    isDurationEstimated,
  };
}

/**
 * Evaluates the resulting video bitrate, audio downscaling, and quality tier for a chosen target size.
 */
export function evaluateTargetSize(
  targetMb: number,
  bounds: SliderBounds,
  width: number = 1280,
  height: number = 720,
  noAudio: boolean = false,
  baseAudioBitrate: number = 128
): BitrateCalculationResult {
  const durationSec = bounds.effectiveDurationSec;
  const sliderPercent =
    bounds.maxMb > bounds.minMb
      ? ((targetMb - bounds.minMb) / (bounds.maxMb - bounds.minMb)) * 100
      : 50;

  // Intelligent audio downscaling matching video-converter.com
  let audioBitrate = noAudio ? 0 : baseAudioBitrate;
  let audioChannels = 2;

  if (!noAudio) {
    if (sliderPercent <= 5) {
      audioBitrate = Math.min(audioBitrate, 48);
      audioChannels = 1;
    } else if (sliderPercent <= 10) {
      audioBitrate = Math.min(audioBitrate, 56);
      audioChannels = 1;
    } else if (sliderPercent <= 20) {
      audioBitrate = Math.min(audioBitrate, 64);
      audioChannels = 1;
    } else if (sliderPercent <= 30) {
      audioBitrate = Math.min(audioBitrate, 80);
      audioChannels = 1;
    }
  }

  const videoBitrateKbps = calcVideoBitrate(targetMb, durationSec, audioBitrate);
  const bpp = calcBpp(videoBitrateKbps, width, height);

  let qualityLevel: 'low' | 'balanced' | 'high' | 'ultra' = 'balanced';
  if (bpp < 0.055) {
    qualityLevel = 'low';
  } else if (bpp < 0.12) {
    qualityLevel = 'balanced';
  } else if (bpp < 0.22) {
    qualityLevel = 'high';
  } else {
    qualityLevel = 'ultra';
  }

  return {
    videoBitrateKbps,
    audioBitrateKbps: audioBitrate,
    audioChannels,
    qualityLevel,
    bpp,
  };
}
