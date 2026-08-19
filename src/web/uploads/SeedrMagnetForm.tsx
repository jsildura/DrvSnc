import React, { useState, useEffect, useRef } from 'react';
import {
  getSeedrStatus,
  getSeedrDeviceCode,
  authorizeSeedrDevice,
  loginSeedrAccount,
  submitSeedrTransfer,
  SeedrStatusResponse,
  SeedrDeviceCodeData,
} from '../api/seedr';
import { FolderPicker } from '../components/FolderPicker';

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function SeedrMagnetForm({ onJobCreated }: { onJobCreated: () => void }) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [seedrStatus, setSeedrStatus] = useState<SeedrStatusResponse>({ connected: false });

  // Connection mode: device or password
  const [authMethod, setAuthMethod] = useState<'device' | 'password'>('device');
  const [seedrEmail, setSeedrEmail] = useState('');
  const [seedrPassword, setSeedrPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Device Code Authorization Flow State
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [deviceCodeData, setDeviceCodeData] = useState<SeedrDeviceCodeData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const pollTimerRef = useRef<any>(null);

  // Magnet Transfer Form State
  const [magnetLink, setMagnetLink] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedFolderName, setSelectedFolderName] = useState<string>('My Drive (Root)');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transferMessage, setTransferMessage] = useState<{ text: string; variant: 'success' | 'error' | 'info' } | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await getSeedrStatus();
      setSeedrStatus(res);
    } catch {
      setSeedrStatus({ connected: false });
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedrEmail.trim() || !seedrPassword.trim()) return;

    setIsLoggingIn(true);
    setAuthError(null);
    try {
      await loginSeedrAccount(seedrEmail.trim(), seedrPassword.trim());
      setSeedrPassword('');
      fetchStatus();
    } catch (err) {
      setAuthError((err as Error).message || 'Failed to login with Seedr account');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Start Device Code Linking Flow
  const handleStartDeviceAuth = async () => {
    setIsAuthorizing(true);
    setAuthError(null);
    try {
      const data = await getSeedrDeviceCode();
      setDeviceCodeData(data);

      // Start polling every 4 seconds
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const check = await authorizeSeedrDevice(data.device_code);
          if (check.success) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setIsAuthorizing(false);
            setDeviceCodeData(null);
            fetchStatus();
          }
        } catch {
          // Continue polling until expiration
        }
      }, 4000);
    } catch (err) {
      setAuthError((err as Error).message || 'Failed to start Seedr device pairing');
      setIsAuthorizing(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  // Submit Magnet Transfer
  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMagnet = magnetLink.trim();
    if (!cleanMagnet) return;

    if (!cleanMagnet.toLowerCase().startsWith('magnet:?')) {
      setTransferMessage({
        text: 'Please paste a valid magnet link starting with magnet:?xt=...',
        variant: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    setTransferMessage(null);

    try {
      const res = await submitSeedrTransfer({
        magnetLink: cleanMagnet,
        folderId: selectedFolderId || undefined,
        filename: customFilename.trim() || undefined,
      });

      setTransferMessage({
        text: res.message || 'Torrent added! Transferring to Google Drive...',
        variant: 'success',
      });
      setMagnetLink('');
      setCustomFilename('');
      onJobCreated();
      fetchStatus();
    } catch (err) {
      setTransferMessage({
        text: (err as Error).message || 'Failed to transfer torrent',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (statusLoading) {
    return (
      <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
        Loading Seedr integration status...
      </div>
    );
  }

  // =========================================================================
  // VIEW 1: NOT CONNECTED (Device Code Link Card)
  // =========================================================================
  if (!seedrStatus.connected) {
    return (
      <div className="space-y-6">
        <div className="p-6 sm:p-8 rounded-3xl border border-indigo-200/80 dark:border-indigo-900/60 bg-gradient-to-b from-indigo-50/50 to-white/50 dark:from-indigo-950/20 dark:to-slate-900/50 backdrop-blur-xl shadow-sm space-y-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Remote Torrent & Magnet Downloads
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Download torrent files at 10 Gbps cloud speeds and stream directly into Google Drive.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="flex items-center gap-1.5 font-bold text-indigo-600 dark:text-indigo-400">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V6a2 2 0 10-2 2h2zm-7 4h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z" />
                </svg>
                <span>100% Free</span>
              </span>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Uses Seedr's free cloud seedbox (up to 2GB per torrent, no card needed).
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Instant Cache</span>
              </span>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Popular torrents transfer to Google Drive in seconds.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="flex items-center gap-1.5 font-bold text-blue-600 dark:text-blue-400">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Auto-Recycled</span>
              </span>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Automatically frees up Seedr space after Google Drive upload finishes.
              </p>
            </div>
          </div>

          {/* Auth Method Selector */}
          <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit text-xs">
            <button
              type="button"
              onClick={() => {
                setAuthMethod('device');
                setAuthError(null);
              }}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                authMethod === 'device'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              1-Click Device Link
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMethod('password');
                setAuthError(null);
              }}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                authMethod === 'password'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Seedr Account Login
            </button>
          </div>

          {authMethod === 'device' && !isAuthorizing && !deviceCodeData && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleStartDeviceAuth}
                className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
              >
                <span>Connect Seedr.cc</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          )}

          {/* Device Code Pairing Modal/Step */}
          {authMethod === 'device' && deviceCodeData && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 shadow-xl space-y-4 animate-fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Authorize App with Seedr.cc
                </h4>
                <span className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  Waiting for authorization...
                </span>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-300">
                ⚠️ <strong>Important:</strong> Please ensure you are logged into your <a href="https://www.seedr.cc" target="_blank" rel="noopener noreferrer" className="underline font-bold">Seedr.cc</a> account in this browser before adding the code on <code>seedr.cc/devices</code>.
              </div>

              <div className="space-y-2">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  1. Copy this 8-digit device code:
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-base font-bold text-indigo-600 dark:text-indigo-400 tracking-wider text-center select-all">
                    {deviceCodeData.user_code}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(deviceCodeData.user_code)}
                    className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold transition-colors shrink-0"
                  >
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  2. Open Seedr devices page and enter the code into "Add Media Device":
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                  <a
                    href={deviceCodeData.verification_url || 'https://www.seedr.cc/devices'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors"
                  >
                    <span>Open seedr.cc/devices</span>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const check = await authorizeSeedrDevice(deviceCodeData.device_code);
                        if (check.success) {
                          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                          setIsAuthorizing(false);
                          setDeviceCodeData(null);
                          fetchStatus();
                        } else {
                          setAuthError('Seedr authorization pending. If you previously approved an older code, please click "Cancel or Generate New Code" below.');
                        }
                      } catch (err) {
                        setAuthError((err as Error).message);
                      }
                    }}
                    className="w-full sm:flex-1 py-2.5 px-4 rounded-xl border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>I Approved on Seedr</span>
                  </button>
                </div>

                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                      setDeviceCodeData(null);
                      setIsAuthorizing(false);
                      setAuthError(null);
                    }}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline transition-colors"
                  >
                    Cancel or Generate New Code
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Password Login Form */}
          {authMethod === 'password' && (
            <form onSubmit={handlePasswordLogin} className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 shadow-xl space-y-3 animate-fade-in">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Log In with Seedr Account
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Don't have an account? <a href="https://www.seedr.cc" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">Register free on Seedr.cc</a>
              </p>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Seedr Email / Username
                </label>
                <input
                  type="email"
                  required
                  value={seedrEmail}
                  onChange={(e) => setSeedrEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  className="mt-1 w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Seedr Password
                </label>
                <input
                  type="password"
                  required
                  value={seedrPassword}
                  onChange={(e) => setSeedrPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoggingIn || !seedrEmail || !seedrPassword}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                {isLoggingIn ? 'Logging in...' : 'Connect with Seedr Account'}
              </button>
            </form>
          )}

          {authError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{authError}</p>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: CONNECTED (Magnet Link & Torrent Submission Form)
  // =========================================================================
  const usedSpace = seedrStatus.spaceUsed || 0;
  const maxSpace = seedrStatus.spaceMax || 2147483648;
  const usedPercent = Math.min(100, Math.round((usedSpace / maxSpace) * 100));

  return (
    <form onSubmit={handleSubmitTransfer} className="space-y-5">
      {/* Account & Space Meter Bar */}
      <div className="p-3.5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/50 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Connected to Seedr ({seedrStatus.username || 'Free Account'})
          </span>
        </div>

        <div className="flex items-center gap-2 min-w-[140px]">
          <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                usedPercent > 85 ? 'bg-rose-500' : usedPercent > 60 ? 'bg-amber-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {formatBytes(usedSpace)} / {formatBytes(maxSpace)}
          </span>
        </div>
      </div>

      {/* Magnet Link Input Field */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Magnet Link or Torrent Info Hash
        </label>
        <textarea
          rows={3}
          value={magnetLink}
          onChange={(e) => setMagnetLink(e.target.value)}
          required
          placeholder="magnet:?xt=urn:btih:..."
          className="w-full font-mono text-xs p-3 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* Custom Filename Input (Optional) */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Target Filename (Optional)
        </label>
        <input
          type="text"
          value={customFilename}
          onChange={(e) => setCustomFilename(e.target.value)}
          placeholder="e.g. MyDownloadedMovie.mp4 or Dataset.zip"
          className="w-full text-xs p-3 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Destination Folder Selector */}
      <FolderPicker
        selectedFolderId={selectedFolderId}
        selectedFolderName={selectedFolderName}
        onSelect={(folderId, folderName) => {
          setSelectedFolderId(folderId || undefined);
          setSelectedFolderName(folderName || 'My Drive (Root)');
        }}
      />

      {/* Feedback Messages */}
      {transferMessage && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-medium border ${
            transferMessage.variant === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
          }`}
        >
          {transferMessage.text}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!magnetLink.trim() || isSubmitting}
        className="w-full py-3 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
      >
        {isSubmitting ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span>Submitting to Seedr Cloud...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Download Magnet & Transfer to Drive</span>
          </>
        )}
      </button>
    </form>
  );
}
