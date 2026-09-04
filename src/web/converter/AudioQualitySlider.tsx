import React from 'react';
import { AUDIO_FORMATS, AUDIO_PRESET_MAP, AudioFormatDetails, AudioPresetStop } from './types';

interface AudioQualitySliderProps {
  format: string;
  selectedPreset: string; // 'first' | 'second' | 'third' | 'fourth' (or 'standard' fallback)
  onSelectPreset: (presetId: 'first' | 'second' | 'third' | 'fourth') => void;
}

const PRESET_KEYS: Array<'first' | 'second' | 'third' | 'fourth'> = ['first', 'second', 'third', 'fourth'];

export function AudioQualitySlider({ format, selectedPreset, onSelectPreset }: AudioQualitySliderProps) {
  const formatConfig: AudioFormatDetails | undefined = AUDIO_FORMATS[format] || AUDIO_FORMATS.mp3;
  const presets = formatConfig?.presets;

  // Normalize preset key
  let normalizedKey: 'first' | 'second' | 'third' | 'fourth' = 'second';
  if (selectedPreset === 'first' || selectedPreset === 'economy') {
    normalizedKey = 'first';
  } else if (selectedPreset === 'third' || selectedPreset === 'good') {
    normalizedKey = 'third';
  } else if (selectedPreset === 'fourth' || selectedPreset === 'best') {
    normalizedKey = 'fourth';
  } else if (selectedPreset === 'second' || selectedPreset === 'standard') {
    normalizedKey = 'second';
  } else if (formatConfig?.defaultPreset) {
    normalizedKey = formatConfig.defaultPreset;
  }

  const activeIndex = (AUDIO_PRESET_MAP as any)[normalizedKey] ?? 1;

  // If format doesn't have 4 presets (e.g. FLAC or AMR)
  if (!presets) {
    return (
      <fieldset className="relative rounded-2xl border border-[#9ea7b4]/80 dark:border-[#434d5e] bg-white/40 dark:bg-black/20 p-4 pt-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05),0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
        <legend className="mx-auto px-2.5 text-xs font-bold text-slate-700 dark:text-slate-200">
          Quality
        </legend>
        <div className="flex items-center justify-center py-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
          {format === 'flac' ? (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Lossless Audio Quality — Bit-perfect audio without loss of compression data</span>
            </div>
          ) : (
            <span>Adaptive Speech Bitrate ({format.toUpperCase()})</span>
          )}
        </div>
      </fieldset>
    );
  }

  // Thumb positions as percentage across 0, 1, 2, 3
  const percentage = (activeIndex / 3) * 100;

  return (
    <fieldset className="relative rounded-2xl border border-[#9ea7b4]/80 dark:border-[#434d5e] bg-white/40 dark:bg-black/20 p-4 pt-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05),0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
      <legend className="mx-auto px-2.5 text-xs font-bold text-slate-700 dark:text-slate-200">
        Quality
      </legend>

      <div className="px-2 pt-2 pb-1 select-none">
        {/* Track Container */}
        <div className="relative h-6 flex items-center">
          {/* Groove Track Background */}
          <div
            className="relative w-full h-3 rounded-full bg-[#4a525f] dark:bg-[#1a202c] shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)] cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, clickX / rect.width));
              const stepIndex = Math.round(ratio * 3) as 0 | 1 | 2 | 3;
              const targetKey = AUDIO_PRESET_MAP[stepIndex] as 'first' | 'second' | 'third' | 'fourth';
              onSelectPreset(targetKey);
            }}
          >
            {/* Gradient Colored Progress Bar up to Thumb */}
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#e74c3c] via-[#f39c12] to-[#f1c40f] shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)] transition-all duration-200 ease-out"
              style={{ width: `${percentage}%` }}
            />

            {/* Recessed Stop Marks along Track */}
            {PRESET_KEYS.map((key, idx) => {
              const stopPercent = (idx / 3) * 100;
              const isPastOrActive = idx <= activeIndex;
              return (
                <div
                  key={key}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border transition-colors ${
                    isPastOrActive
                      ? 'bg-amber-100 border-amber-500/60 shadow-sm'
                      : 'bg-[#2d333d] border-black/40 shadow-inner'
                  }`}
                  style={{ left: `${stopPercent}%` }}
                  aria-hidden="true"
                />
              );
            })}
          </div>

          {/* Skeuomorphic Slider Thumb with ridges and downward pointer */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-9 cursor-pointer z-10 filter drop-shadow-[0_3px_5px_rgba(0,0,0,0.35)] transition-all duration-200 ease-out flex flex-col items-center"
            style={{ left: `${percentage}%` }}
          >
            {/* Metallic Body */}
            <div className="w-full h-7 rounded-md bg-gradient-to-b from-[#ffffff] via-[#ebedf2] to-[#c7ccd6] dark:from-[#f1f5f9] dark:to-[#94a3b8] border border-slate-400 dark:border-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.2)] flex items-center justify-center gap-0.5">
              {/* Vertical Grips */}
              <div className="w-0.5 h-3.5 bg-slate-400 dark:bg-slate-500 rounded-full" />
              <div className="w-0.5 h-3.5 bg-slate-400 dark:bg-slate-500 rounded-full" />
              <div className="w-0.5 h-3.5 bg-slate-400 dark:bg-slate-500 rounded-full" />
            </div>
            {/* Downward Pointer Triangle */}
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#c7ccd6] dark:border-t-[#94a3b8] -mt-[1px]" />
          </div>
        </div>

        {/* Labels below stops */}
        <div className="relative mt-2.5 flex justify-between text-center">
          {PRESET_KEYS.map((key, idx) => {
            const presetItem: AudioPresetStop | undefined = presets[key];
            if (!presetItem) return null;
            const isSelected = normalizedKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectPreset(key)}
                className={`flex flex-col items-center cursor-pointer transition-all hover:opacity-100 ${
                  isSelected
                    ? 'opacity-100 font-bold scale-105'
                    : 'opacity-75 hover:opacity-90'
                }`}
                style={{
                  width: '25%',
                  textAlign: 'center',
                }}
              >
                <span className={`text-xs ${isSelected ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                  {presetItem.name}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {presetItem.name2}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
