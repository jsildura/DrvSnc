import React, { useState, useRef, useEffect } from 'react';
import { PresetItem, VIDEO_RESOLUTIONS } from './types';

interface ResolutionDropdownProps {
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  className?: string;
}

export function ResolutionDropdown({
  selectedPresetId,
  onSelectPreset,
  className = '',
}: ResolutionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItem =
    VIDEO_RESOLUTIONS.find((r) => r.id === selectedPresetId) || VIDEO_RESOLUTIONS[0];

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* Pill Trigger Button styled exactly like Image 1 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center justify-between gap-3 px-3.5 py-1.5 min-w-[150px] text-xs font-semibold text-slate-700 dark:text-slate-200 bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-850 hover:from-slate-50 hover:to-slate-150 border border-slate-300 dark:border-slate-700 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.08)] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.2)] transition-all cursor-pointer"
      >
        <span className="truncate">{selectedItem.name}</span>
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu styled exactly like Image 2 */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-64 z-50 rounded-xl bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-850 dark:to-slate-900 border border-slate-300/90 dark:border-slate-700 shadow-xl py-1.5 text-xs animate-fade-in divide-y divide-slate-200/50 dark:divide-slate-800/50">
          <div className="py-1">
            {VIDEO_RESOLUTIONS.map((res) => {
              const isSelected = res.id === selectedPresetId;
              return (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => {
                    onSelectPreset(res.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-1.5 transition-colors text-left ${
                    isSelected
                      ? 'bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-300/50 dark:hover:bg-slate-750 font-medium'
                  }`}
                >
                  <span>{res.name}</span>
                  {res.name2 && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {res.name2}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
