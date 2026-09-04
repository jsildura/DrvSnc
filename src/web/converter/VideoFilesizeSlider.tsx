import React, { useMemo, useState, useEffect } from 'react';
import {
  SliderBounds,
  evaluateTargetSize,
} from './filesizeEstimator';

interface VideoFilesizeSliderProps {
  bounds: SliderBounds;
  targetMb: number;
  width?: number;
  height?: number;
  noAudio?: boolean;
  baseAudioBitrate?: number;
  onChangeTargetMb: (mb: number) => void;
  onResetToDefault: () => void;
}

export function VideoFilesizeSlider({
  bounds,
  targetMb,
  width = 1280,
  height = 720,
  noAudio = false,
  baseAudioBitrate = 128,
  onChangeTargetMb,
  onResetToDefault,
}: VideoFilesizeSliderProps) {
  const { minMb, maxMb, defaultMb, stepMb } = bounds;

  // Clamped value within current bounds
  const currentVal = Math.min(maxMb, Math.max(minMb, targetMb));

  // Compute percentage for positioning the indicator bubble
  const percent = useMemo(() => {
    if (maxMb <= minMb) return 50;
    return Math.max(0, Math.min(100, ((currentVal - minMb) / (maxMb - minMb)) * 100));
  }, [currentVal, minMb, maxMb]);

  // Evaluate quality and bitrate
  const evaluation = useMemo(() => {
    return evaluateTargetSize(currentVal, bounds, width, height, noAudio, baseAudioBitrate);
  }, [currentVal, bounds, width, height, noAudio, baseAudioBitrate]);

  const isCustomized = Math.abs(currentVal - defaultMb) > 1;

  const qualityColorClass = useMemo(() => {
    switch (evaluation.qualityLevel) {
      case 'low':
        return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800';
      case 'balanced':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800';
      case 'high':
      case 'ultra':
        return 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800';
    }
  }, [evaluation.qualityLevel]);

  return (
    <div className="pt-2 pb-1 space-y-2.5">
      {/* Header and Reset Button */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="estimated-filesize-slider"
          className="text-slate-700 dark:text-slate-300 font-semibold text-xs flex items-center gap-1.5"
        >
          <span>Estimated output file size:</span>
          {bounds.isDurationEstimated && (
            <span className="text-[10px] text-slate-400 font-normal italic">
              (approx. duration)
            </span>
          )}
        </label>
        {isCustomized && (
          <button
            type="button"
            onClick={onResetToDefault}
            className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
          >
            Reset to Auto
          </button>
        )}
      </div>

      {/* Slider Track Area */}
      <div className="relative pt-1 pb-6 px-1">
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 select-none">
          <span>{minMb} Mb</span>
          <span>{maxMb} Mb</span>
        </div>

        {/* The Range Input */}
        <div className="relative flex items-center">
          <input
            id="estimated-filesize-slider"
            type="range"
            min={minMb}
            max={maxMb}
            step={stepMb}
            value={currentVal}
            onChange={(e) => onChangeTargetMb(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-500 focus:outline-none"
          />

          {/* Draggable Value Badge / Bubble (replicating video-converter.com's pointer tooltip) */}
          <div
            className="absolute top-4 pointer-events-none transition-transform duration-75 ease-out -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${percent}%` }}
          >
            {/* Triangular arrow tip */}
            <div className="w-0 h-0 border-x-4 border-x-transparent border-b-4 border-b-slate-800 dark:border-b-slate-100" />
            {/* Rounded badge */}
            <div className="px-2 py-0.5 rounded-md bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold shadow-md tracking-tight whitespace-nowrap">
              {currentVal} Mb
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Bitrate & Compression Quality Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] border-t border-slate-100 dark:border-slate-800/60">
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span>Video Bitrate:</span>
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-200">
            ~{(evaluation.videoBitrateKbps).toLocaleString()} kbps
          </span>
          {!noAudio && (
            <span className="text-slate-400 dark:text-slate-500">
              (audio: {evaluation.audioBitrateKbps}k {evaluation.audioChannels === 1 ? 'mono' : 'stereo'})
            </span>
          )}
        </div>

        <div className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${qualityColorClass}`}>
          {evaluation.qualityLevel} Quality
        </div>
      </div>
    </div>
  );
}
