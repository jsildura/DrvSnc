import React from 'react';
import { AUDIO_FORMATS, AudioAdvancedOptions, AudioFormatDetails } from './types';

interface AudioAdvancedSettingsProps {
  format: string;
  options: AudioAdvancedOptions;
  onChange: (updated: Partial<AudioAdvancedOptions>) => void;
}

export function AudioAdvancedSettings({ format, options, onChange }: AudioAdvancedSettingsProps) {
  const formatConfig: AudioFormatDetails | undefined = AUDIO_FORMATS[format] || AUDIO_FORMATS.mp3;
  const bitrates = formatConfig?.bitrates || [64, 96, 128, 160, 192, 224, 256, 320];
  const sampleRates = formatConfig?.sampleRates || [22050, 32000, 44100, 48000];
  const channelsList = formatConfig?.channels || [1, 2];

  const hasBitrates = Boolean(formatConfig?.bitrates && formatConfig.bitrates.length > 0);
  const hasVariable = Boolean(formatConfig?.bitratesVariable);

  return (
    <div className="w-full rounded-2xl bg-gradient-to-b from-[#2e3745] to-[#222934] border border-[#404c5e] p-5 shadow-[inset_0_3px_10px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.08)] text-white text-xs animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
        {/* ======================================================== */}
        {/* Column 1: Bitrate (Constant vs Variable)                */}
        {/* ======================================================== */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300 w-16 shrink-0">Bitrate</span>

            <div className="space-y-2 flex-1">
              {/* Constant Bitrate */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="bitrate_type"
                    value="constant"
                    checked={options.bitrateType === 'constant'}
                    onChange={() => onChange({ bitrateType: 'constant' })}
                    disabled={!hasBitrates}
                    className="accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-slate-200">Constant</span>
                </label>

                {options.bitrateType === 'constant' && hasBitrates && (
                  <select
                    value={options.constantBitrate}
                    onChange={(e) => onChange({ constantBitrate: Number(e.target.value) })}
                    className="px-2.5 py-1 text-xs font-semibold text-white bg-gradient-to-b from-[#475365] to-[#313a48] border border-slate-600 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] focus:outline-none focus:border-indigo-400 cursor-pointer"
                  >
                    {bitrates.map((b) => (
                      <option key={b} value={b}>
                        {b} kbps
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Variable Bitrate (if supported) */}
              {hasVariable && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="bitrate_type"
                      value="variable"
                      checked={options.bitrateType === 'variable'}
                      onChange={() => onChange({ bitrateType: 'variable' })}
                      className="accent-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs font-medium text-slate-200">Variable</span>
                  </label>

                  {options.bitrateType === 'variable' && (
                    <select
                      value={options.variableBitrate}
                      onChange={(e) => onChange({ variableBitrate: Number(e.target.value) })}
                      className="px-2.5 py-1 text-xs font-semibold text-white bg-gradient-to-b from-[#475365] to-[#313a48] border border-slate-600 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] focus:outline-none focus:border-indigo-400 cursor-pointer"
                    >
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((q) => (
                        <option key={q} value={q}>
                          Q{q} {q <= 2 ? '(High Quality)' : q <= 6 ? '(Standard)' : '(Economy)'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* Column 2: Sample Rate & Channels                         */}
        {/* ======================================================== */}
        <div className="space-y-3">
          {/* Sample rate */}
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="audio_sample_rate" className="font-bold text-slate-300">
              Sample rate
            </label>
            <select
              id="audio_sample_rate"
              value={options.sampleRate}
              onChange={(e) => onChange({ sampleRate: Number(e.target.value) })}
              className="px-2.5 py-1 text-xs font-semibold text-white bg-gradient-to-b from-[#475365] to-[#313a48] border border-slate-600 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] focus:outline-none focus:border-indigo-400 cursor-pointer min-w-[105px]"
            >
              {sampleRates.map((sr) => (
                <option key={sr} value={sr}>
                  {sr >= 1000 ? `${sr} Khz` : `${sr} Hz`}
                </option>
              ))}
            </select>
          </div>

          {/* Channels */}
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="audio_channels" className="font-bold text-slate-300">
              Channels
            </label>
            <select
              id="audio_channels"
              value={options.channels}
              onChange={(e) => onChange({ channels: Number(e.target.value) })}
              className="px-2.5 py-1 text-xs font-semibold text-white bg-gradient-to-b from-[#475365] to-[#313a48] border border-slate-600 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] focus:outline-none focus:border-indigo-400 cursor-pointer min-w-[105px]"
            >
              {channelsList.includes(1) && <option value={1}>1 (Mono)</option>}
              {channelsList.includes(2) && <option value={2}>2 (Stereo)</option>}
            </select>
          </div>
        </div>

        {/* ======================================================== */}
        {/* Column 3: Audio Effects Checkboxes                       */}
        {/* ======================================================== */}
        <div className="space-y-2.5 pl-0 sm:pl-4 sm:border-l border-slate-700/60">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200 hover:text-white">
            <input
              type="checkbox"
              checked={options.fadeIn}
              onChange={(e) => onChange({ fadeIn: e.target.checked })}
              className="w-4 h-4 rounded bg-[#1e2530] border-slate-600 text-indigo-500 focus:ring-0 focus:outline-none cursor-pointer"
            />
            <span>Fade in</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200 hover:text-white">
            <input
              type="checkbox"
              checked={options.fadeOut}
              onChange={(e) => onChange({ fadeOut: e.target.checked })}
              className="w-4 h-4 rounded bg-[#1e2530] border-slate-600 text-indigo-500 focus:ring-0 focus:outline-none cursor-pointer"
            />
            <span>Fade out</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200 hover:text-white">
            <input
              type="checkbox"
              checked={options.reverse}
              onChange={(e) => onChange({ reverse: e.target.checked })}
              className="w-4 h-4 rounded bg-[#1e2530] border-slate-600 text-indigo-500 focus:ring-0 focus:outline-none cursor-pointer"
            />
            <span>Reverse</span>
          </label>
        </div>
      </div>
    </div>
  );
}
