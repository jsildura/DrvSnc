import React from 'react';
import { ConverterPanel } from '../converter/ConverterPanel';

export function ConverterPage() {
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Media & Document Converter
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Select videos, audio tracks, or documents from your Google Drive, configure target formats and quality options, and save converted files directly back to Google Drive.
        </p>
      </div>

      {/* Main Converter UI Panel */}
      <div className="relative z-10 flex justify-center">
        <ConverterPanel />
      </div>

      {/* Information Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200/60 dark:border-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
        <div className="p-4 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800/60 space-y-1">
          <span className="font-bold text-slate-800 dark:text-slate-200 block">
            Video & Audio Conversion
          </span>
          <p>
            Convert between MP4, AVI, MOV, WebM, FLV, 3GP, MKV, or extract high-fidelity audio in MP3, WAV, M4A, FLAC, and OGG.
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800/60 space-y-1">
          <span className="font-bold text-slate-800 dark:text-slate-200 block">
            Document & Quality Controls
          </span>
          <p>
            Fine-tune video resolutions up to 1080p, audio bitrates up to 320 kbps, and convert document formats seamlessly.
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800/60 space-y-1">
          <span className="font-bold text-slate-800 dark:text-slate-200 block">
            Direct Cloud Sync
          </span>
          <p>
            Zero manual file re-uploading — select straight from your Google Drive and save converted outputs back to any folder.
          </p>
        </div>
      </div>
    </div>
  );
}
