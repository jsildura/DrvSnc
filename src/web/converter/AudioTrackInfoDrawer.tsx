import React from 'react';
import { TrackInfo } from './types';

interface AudioTrackInfoDrawerProps {
  trackInfo: TrackInfo;
  onChange: (updated: Partial<TrackInfo>) => void;
  onClear: () => void;
}

export function AudioTrackInfoDrawer({ trackInfo, onChange, onClear }: AudioTrackInfoDrawerProps) {
  return (
    <div className="w-full rounded-2xl bg-gradient-to-b from-[#2e3745] to-[#222934] border border-[#404c5e] p-5 shadow-[inset_0_3px_10px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.08)] text-white text-xs animate-fade-in space-y-4">
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
        <span className="font-bold text-slate-200">Edit Audio Track Information (ID3 Tags)</span>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-slate-400 hover:text-rose-300 transition-colors"
        >
          Clear tags
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Title */}
        <div className="space-y-1">
          <label htmlFor="track_tag_title" className="text-[11px] font-semibold text-slate-300">
            Title
          </label>
          <input
            id="track_tag_title"
            type="text"
            value={trackInfo.title}
            onChange={(e) => onChange({ title: e.target.value, setTag: true })}
            placeholder="Track Title"
            className="w-full px-3 py-1.5 text-xs text-white bg-[#1e2531] border border-slate-600 rounded-lg shadow-inner focus:outline-none focus:border-indigo-400 placeholder-slate-500"
          />
        </div>

        {/* Artist */}
        <div className="space-y-1">
          <label htmlFor="track_tag_artist" className="text-[11px] font-semibold text-slate-300">
            Artist
          </label>
          <input
            id="track_tag_artist"
            type="text"
            value={trackInfo.artist}
            onChange={(e) => onChange({ artist: e.target.value, setTag: true })}
            placeholder="Artist / Performer"
            className="w-full px-3 py-1.5 text-xs text-white bg-[#1e2531] border border-slate-600 rounded-lg shadow-inner focus:outline-none focus:border-indigo-400 placeholder-slate-500"
          />
        </div>

        {/* Album */}
        <div className="space-y-1">
          <label htmlFor="track_tag_album" className="text-[11px] font-semibold text-slate-300">
            Album
          </label>
          <input
            id="track_tag_album"
            type="text"
            value={trackInfo.album}
            onChange={(e) => onChange({ album: e.target.value, setTag: true })}
            placeholder="Album Name"
            className="w-full px-3 py-1.5 text-xs text-white bg-[#1e2531] border border-slate-600 rounded-lg shadow-inner focus:outline-none focus:border-indigo-400 placeholder-slate-500"
          />
        </div>

        {/* Year */}
        <div className="space-y-1">
          <label htmlFor="track_tag_year" className="text-[11px] font-semibold text-slate-300">
            Year
          </label>
          <input
            id="track_tag_year"
            type="text"
            value={trackInfo.year}
            onChange={(e) => onChange({ year: e.target.value, setTag: true })}
            placeholder="e.g. 2026"
            className="w-full px-3 py-1.5 text-xs text-white bg-[#1e2531] border border-slate-600 rounded-lg shadow-inner focus:outline-none focus:border-indigo-400 placeholder-slate-500"
          />
        </div>

        {/* Genre */}
        <div className="space-y-1">
          <label htmlFor="track_tag_genre" className="text-[11px] font-semibold text-slate-300">
            Genre
          </label>
          <input
            id="track_tag_genre"
            type="text"
            value={trackInfo.genre}
            onChange={(e) => onChange({ genre: e.target.value, setTag: true })}
            placeholder="e.g. Rock, Pop, Soundtrack"
            className="w-full px-3 py-1.5 text-xs text-white bg-[#1e2531] border border-slate-600 rounded-lg shadow-inner focus:outline-none focus:border-indigo-400 placeholder-slate-500"
          />
        </div>

        {/* Comment */}
        <div className="space-y-1">
          <label htmlFor="track_tag_comment" className="text-[11px] font-semibold text-slate-300">
            Comment
          </label>
          <input
            id="track_tag_comment"
            type="text"
            value={trackInfo.comment}
            onChange={(e) => onChange({ comment: e.target.value, setTag: true })}
            placeholder="Track Comments"
            className="w-full px-3 py-1.5 text-xs text-white bg-[#1e2531] border border-slate-600 rounded-lg shadow-inner focus:outline-none focus:border-indigo-400 placeholder-slate-500"
          />
        </div>
      </div>
    </div>
  );
}
