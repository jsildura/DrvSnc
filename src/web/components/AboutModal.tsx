import React, { useEffect } from 'react';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  description?: string;
}

export function AboutModal({
  isOpen,
  onClose,
  title = 'CloudDrive Sync',
  subtitle = 'High-Speed Cloud Transfer & Media Suite',
  description = 'Transfer large files directly to your Google Drive, convert audio/video/document, extract archives, and manage your cloud storage seamlessly.',
}: AboutModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/45 backdrop-blur-[16px] animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[400px] max-h-[85vh] flex flex-col rounded-[20px] border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#242428] shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden animate-modal-slide-up"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200/60 dark:border-white/[0.08] shrink-0">
          <h2 id="info-title" className="text-[1.1rem] font-semibold text-slate-900 dark:text-[#f5f5f7]">
            About
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-[#2e2e34] dark:hover:bg-[#34343c] text-slate-500 hover:text-slate-900 dark:text-[#a1a1a6] dark:hover:text-[#f5f5f7] text-[1.2rem] leading-none transition-all cursor-pointer"
          >
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div className="px-6 py-5 overflow-y-auto">
          <div className="text-center py-2.5">
            <h3 className="text-[1.6rem] font-bold tracking-tight mb-1 bg-gradient-to-br from-slate-900 via-slate-800 to-[#ff375f] dark:from-white dark:to-[#ff375f] bg-clip-text text-transparent">
              {title}
            </h3>

            <p className="text-[0.8rem] text-slate-500 dark:text-[#6e6e73] mb-4">
              {subtitle}
            </p>

            <p className="text-[0.85rem] text-slate-600 dark:text-[#a1a1a6] leading-[1.6] mb-5">
              {description}
            </p>

            <div className="flex justify-center gap-5 text-[0.85rem] font-medium text-slate-600 dark:text-[#a1a1a6]">
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutModal;
