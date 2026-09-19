import React, { useState, useEffect } from 'react';
import { useApp } from '../state/AppProvider';
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR, getContrastText } from '../theme/accentColors';
import {
  getSeedrStatus,
  loginSeedrAccount,
  disconnectSeedr,
  SeedrStatusResponse,
} from '../api/seedr';

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function SettingsPage() {
  const {
    user,
    preferences,
    isLoading,
    updatePreferences,
    logout,
    deleteAccount,
    theme,
    setTheme,
    accentColor,
    setAccentColor,
  } = useApp();

  const [filenamePattern, setFilenamePattern] = useState(
    preferences?.filenamePattern || '{filename}'
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    preferences?.notificationsEnabled ?? true
  );
  const [rememberAccount, setRememberAccount] = useState(
    preferences?.rememberAccount ?? true
  );
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Seedr integration state
  const [seedrStatus, setSeedrStatus] = useState<SeedrStatusResponse>({ connected: false });
  const [seedrLoading, setSeedrLoading] = useState(true);
  const [seedrEmail, setSeedrEmail] = useState('');
  const [seedrPassword, setSeedrPassword] = useState('');
  const [isSeedrLoggingIn, setIsSeedrLoggingIn] = useState(false);
  const [seedrActionMsg, setSeedrActionMsg] = useState<string | null>(null);
  const [seedrErrorMsg, setSeedrErrorMsg] = useState<string | null>(null);

  const fetchSeedr = async () => {
    try {
      const res = await getSeedrStatus();
      setSeedrStatus(res);
    } catch {
      setSeedrStatus({ connected: false });
    } finally {
      setSeedrLoading(false);
    }
  };

  useEffect(() => {
    fetchSeedr();
  }, []);

  const handleSeedrLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedrEmail.trim() || !seedrPassword.trim()) return;

    setIsSeedrLoggingIn(true);
    setSeedrErrorMsg(null);
    setSeedrActionMsg(null);

    try {
      await loginSeedrAccount(seedrEmail.trim(), seedrPassword.trim());
      setSeedrPassword('');
      setSeedrEmail('');
      setSeedrActionMsg('Seedr account connected successfully!');
      await fetchSeedr();
    } catch (err) {
      setSeedrErrorMsg((err as Error).message || 'Failed to login with Seedr');
    } finally {
      setIsSeedrLoggingIn(false);
    }
  };

  const handleDisconnectSeedr = async () => {
    if (!confirm('Are you sure you want to disconnect your Seedr.cc account?')) return;
    try {
      await disconnectSeedr();
      setSeedrStatus({ connected: false });
      setSeedrActionMsg('Seedr account disconnected.');
      setSeedrErrorMsg(null);
    } catch (err) {
      setSeedrErrorMsg((err as Error).message || 'Failed to disconnect Seedr account');
    }
  };

  useEffect(() => {
    if (preferences) {
      setFilenamePattern(preferences.filenamePattern || '{filename}');
      setNotificationsEnabled(preferences.notificationsEnabled ?? true);
      setRememberAccount(preferences.rememberAccount ?? true);
    }
  }, [preferences]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaveStatus('Saving...');
      await updatePreferences({
        themeMode: theme,
        colorScheme: accentColor,
        filenamePattern,
        notificationsEnabled,
        rememberAccount,
      });
      setSaveStatus('Preferences saved successfully');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus('Failed to save preferences');
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await deleteAccount(true);
    } catch {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 sm:gap-8 max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="space-y-1.5">
        <h1 className="text-2xl sm:text-3xl font-normal tracking-tight text-slate-900 dark:text-slate-100">
          Settings
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage your account preferences, appearance, upload templates, and Google Drive access.
        </p>
      </div>

      {/* Connected Account Card */}
      {isLoading ? (
        <div
          className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 shadow-xs flex flex-col gap-5 animate-pulse"
          aria-label="Loading connected account"
          data-testid="account-loading-skeleton"
        >
          <div className="h-4 w-36 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-28 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
                  <div className="h-4 w-16 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
                </div>
                <div className="h-3 w-40 rounded-full bg-slate-200/50 dark:bg-slate-800/50" />
              </div>
            </div>
            <div className="h-10 w-28 rounded-full bg-slate-200/60 dark:bg-slate-800/60 shrink-0" />
          </div>
        </div>
      ) : (
        <div className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs flex flex-col gap-5 hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
              Connected Account
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-4">
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt={user.name || user.email}
                  className="w-12 h-12 rounded-full border border-slate-200 dark:border-slate-700 object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-accent-light text-accent dark:bg-accent-dark dark:text-accent-textDark flex items-center justify-center font-bold text-lg ring-1 ring-accent-border shrink-0">
                  {user?.name ? user.name[0].toUpperCase() : user?.email ? user.email[0].toUpperCase() : 'U'}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{user?.name}</p>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Connected
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{user?.email}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="min-h-[40px] py-2 px-5 rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all shrink-0 flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent w-full sm:w-auto"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Seedr.cc Cloud Torrent Integration Card */}
      {seedrLoading ? (
        <div
          className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 shadow-xs flex flex-col gap-5 animate-pulse"
          aria-label="Loading Seedr settings"
          data-testid="seedr-loading-skeleton"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="h-5 w-48 rounded-full bg-slate-200/80 dark:bg-slate-800/80 mb-1.5" />
              <div className="h-3.5 w-64 sm:w-80 rounded-full bg-slate-200/50 dark:bg-slate-800/50" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-6 w-20 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
              <div className="h-6 w-32 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="h-4 w-48 sm:w-56 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
            <div className="h-9 w-28 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
          </div>
        </div>
      ) : (
        <div className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs flex flex-col gap-5 hover:shadow-sm transition-shadow">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Seedr.cc Torrent Downloader
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Powers remote Magnet link & torrent file downloads directly to Google Drive.
              </p>
            </div>

            {seedrStatus.connected && (
              <div className="flex flex-wrap items-center gap-2">
                {seedrStatus.isPremium ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50 uppercase tracking-wider flex items-center gap-1">
                    <span>★</span>
                    <span>{seedrStatus.packageName || 'Premium'}</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    Non-Premium
                  </span>
                )}
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900/40 w-fit flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Connected ({formatBytes(seedrStatus.spaceUsed)} / {formatBytes(seedrStatus.spaceMax)})
                </span>
              </div>
            )}
          </div>

          {seedrStatus.connected ? (
            <div className="space-y-4 pt-1">
              {seedrStatus.spaceMax && seedrStatus.spaceMax > 0 ? (
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                    <span>Storage Quota</span>
                    <span>
                      {Math.round(((seedrStatus.spaceUsed || 0) / seedrStatus.spaceMax) * 100)}% used
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out bg-emerald-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(2, (((seedrStatus.spaceUsed || 0) / seedrStatus.spaceMax) * 100))
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Account:</span>{' '}
                  {seedrStatus.username || seedrStatus.email || 'Seedr User'} (
                  {seedrStatus.isPremium ? seedrStatus.packageName || 'Premium' : 'Free Tier'})
                </div>
                <button
                  type="button"
                  onClick={handleDisconnectSeedr}
                  className="min-h-[36px] py-1.5 px-4 rounded-full border border-rose-300 dark:border-rose-900/70 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-all cursor-pointer w-fit"
                >
                  Disconnect Seedr
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSeedrLogin} className="flex flex-col gap-4 pt-2 max-w-md">
              <div className="flex flex-col gap-3.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Seedr Email / Username
                  </label>
                  <input
                    type="email"
                    required
                    value={seedrEmail}
                    onChange={(e) => setSeedrEmail(e.target.value)}
                    placeholder="your-email@example.com"
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Seedr Password
                  </label>
                  <input
                    type="password"
                    required
                    value={seedrPassword}
                    onChange={(e) => setSeedrPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3.5 pt-1">
                <button
                  type="submit"
                  disabled={isSeedrLoggingIn || !seedrEmail.trim() || !seedrPassword.trim()}
                  className="min-h-[40px] py-2 px-5 rounded-full bg-accent hover:bg-accent-hover active:bg-accent-active disabled:opacity-50 text-accent-contrast text-xs sm:text-sm font-semibold shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>{isSeedrLoggingIn ? 'Connecting...' : 'Connect Seedr Account'}</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
                <a
                  href="https://www.seedr.cc"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent dark:text-accent-textDark underline font-medium hover:opacity-80 transition-opacity"
                >
                  Register free
                </a>
              </div>
            </form>
          )}

          {seedrActionMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 text-xs font-medium flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{seedrActionMsg}</span>
            </div>
          )}
          {seedrErrorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 text-xs font-medium flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{seedrErrorMsg}</span>
            </div>
          )}
        </div>
      )}

      {/* Appearance Card */}
      {isLoading ? (
        <div
          className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 shadow-xs flex flex-col gap-6 animate-pulse"
          aria-label="Loading appearance settings"
          data-testid="appearance-loading-skeleton"
        >
          <div>
            <div className="h-5 w-28 rounded-full bg-slate-200/80 dark:bg-slate-800/80 mb-2" />
            <div className="h-3.5 w-72 rounded-full bg-slate-200/50 dark:bg-slate-800/50 mb-4" />
            <div className="h-3.5 w-20 rounded-full bg-slate-200/70 dark:bg-slate-800/70 mb-2.5" />
            <div className="grid grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-11 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
              ))}
            </div>
          </div>

          <div className="pt-5 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <div className="h-3.5 w-24 rounded-full bg-slate-200/70 dark:bg-slate-800/70 mb-1" />
                <div className="h-3 w-80 max-w-full rounded-full bg-slate-200/50 dark:bg-slate-800/50" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="w-10 h-10 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs flex flex-col gap-6 hover:shadow-sm transition-shadow">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Appearance</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Choose how the application and themes look on your device.
            </p>
          </div>

          {/* M3 Segmented Button Group for Theme Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Theme Mode
            </label>
            <div
              className="m3-segmented-button-group border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/60 p-1"
              role="group"
              aria-label="Theme mode selection"
            >
              {(['system', 'light', 'dark'] as const).map((mode) => {
                const isSelected = theme === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setTheme(mode);
                      updatePreferences({ themeMode: mode }).catch((err) => {
                        console.error('Failed to update theme mode on server:', err);
                      });
                    }}
                    className={`m3-segmented-button capitalize ${
                      isSelected
                        ? 'bg-accent text-accent-contrast shadow-xs'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span>{mode}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent Color Customization */}
          <div className="pt-6 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Accent Color
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Customizes Google Drive Explorer folders, buttons, badges, and interactive controls.
                </p>
              </div>
              {accentColor.toLowerCase() !== DEFAULT_ACCENT_COLOR.toLowerCase() && (
                <button
                  type="button"
                  onClick={() => {
                    setAccentColor(DEFAULT_ACCENT_COLOR);
                    updatePreferences({ colorScheme: DEFAULT_ACCENT_COLOR }).catch((err) => {
                      console.error('Failed to update accent color on server:', err);
                    });
                  }}
                  className="text-xs font-medium text-accent dark:text-accent-textDark hover:underline transition-colors cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Preset Swatches & Custom Picker */}
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              {ACCENT_PRESETS.map((preset) => {
                const isSelected =
                  accentColor.toLowerCase() === preset.hex.toLowerCase() ||
                  accentColor.toLowerCase() === preset.id.toLowerCase();
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setAccentColor(preset.hex);
                      updatePreferences({ colorScheme: preset.hex }).catch((err) => {
                        console.error('Failed to update accent color on server:', err);
                      });
                    }}
                    title={preset.name}
                    aria-label={`Select ${preset.name} accent`}
                    className={`group relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-offset-2 ring-accent dark:ring-offset-slate-900 scale-110 shadow-sm'
                        : 'hover:scale-105 opacity-90 hover:opacity-100 shadow-xs'
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  >
                    {isSelected && (
                      <svg
                        className="w-4 h-4 drop-shadow-xs"
                        style={{ color: getContrastText(preset.hex) }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })}

              {/* Custom Color Picker Input */}
              <div className="relative flex items-center ml-1">
                <label
                  title="Custom color"
                  aria-label="Pick custom accent color"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:border-accent overflow-hidden relative shadow-xs transition-all"
                  style={{ backgroundColor: accentColor }}
                >
                  <input
                    type="color"
                    title="Custom accent color"
                    aria-label="Pick custom accent color"
                    value={accentColor.startsWith('#') ? accentColor : DEFAULT_ACCENT_COLOR}
                    onChange={(e) => {
                      const newColor = e.target.value;
                      setAccentColor(newColor);
                      updatePreferences({ colorScheme: newColor }).catch((err) => {
                        console.error('Failed to update accent color on server:', err);
                      });
                    }}
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload & Notification Preferences Form */}
      {isLoading ? (
        <div
          className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 shadow-xs flex flex-col gap-6 animate-pulse"
          aria-label="Loading upload preferences"
          data-testid="upload-preferences-loading-skeleton"
        >
          <div className="h-5 w-40 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />

          <div className="space-y-2">
            <div className="h-3.5 w-36 rounded-full bg-slate-200/70 dark:bg-slate-800/70" />
            <div className="h-10 w-full rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
            <div className="h-3 w-56 rounded-full bg-slate-200/50 dark:bg-slate-800/50" />
          </div>

          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <div className="h-4 w-64 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
              <div className="w-12 h-7 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-4 w-60 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
              <div className="w-12 h-7 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
            </div>
          </div>

          <div className="h-11 w-full sm:w-44 rounded-full bg-slate-200/70 dark:bg-slate-800/70" />
        </div>
      ) : (
        <form
          onSubmit={handleSavePreferences}
          className="p-6 sm:p-7 rounded-3xl border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs flex flex-col gap-6 hover:shadow-sm transition-shadow"
        >
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Upload Preferences
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize upload filenames, transfer alerts, and local credential memory.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Filename Template Pattern
            </label>
            <input
              type="text"
              value={filenamePattern}
              onChange={(e) => setFilenamePattern(e.target.value)}
              placeholder="{filename}"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all font-mono"
            />
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] text-slate-400">Quick insert:</span>
              {['{filename}', '{date}', '{timestamp}'].map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => {
                    if (!filenamePattern.includes(variable)) {
                      setFilenamePattern((prev) => (prev ? `${prev}-${variable}` : variable));
                    }
                  }}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-accent-light hover:text-accent dark:hover:bg-accent-dark dark:hover:text-accent-textDark transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                >
                  + {variable}
                </button>
              ))}
            </div>
          </div>

          {/* Material 3 Interactive Switch Controls */}
          <div className="space-y-3 pt-1">
            {/* Notifications Switch */}
            <label className="flex items-center justify-between gap-4 p-3.5 sm:p-4 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer select-none">
              <div className="space-y-1">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 block">
                  Enable transfer completion notifications
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  Receive system alerts when background Drive uploads and torrent conversions finish.
                </span>
              </div>
              <div className="relative shrink-0">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`m3-switch-track ${
                    notificationsEnabled
                      ? 'bg-accent border-accent'
                      : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
                  }`}
                >
                  <div
                    className={`m3-switch-thumb ${
                      notificationsEnabled
                        ? 'left-[24px] w-6 h-6 bg-accent-contrast text-accent shadow-xs'
                        : 'left-[4px] w-4 h-4 bg-slate-500 dark:bg-slate-400'
                    }`}
                  >
                    {notificationsEnabled && (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </label>

            {/* Remember Account Switch */}
            <label className="flex items-center justify-between gap-4 p-3.5 sm:p-4 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer select-none">
              <div className="space-y-1">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 block">
                  Remember account hint on this device
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  Persists your account email for seamless one-click reauthentication.
                </span>
              </div>
              <div className="relative shrink-0">
                <input
                  type="checkbox"
                  aria-label="Remember account hint on this device"
                  checked={rememberAccount}
                  onChange={(e) => setRememberAccount(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`m3-switch-track ${
                    rememberAccount
                      ? 'bg-accent border-accent'
                      : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
                  }`}
                >
                  <div
                    className={`m3-switch-thumb ${
                      rememberAccount
                        ? 'left-[24px] w-6 h-6 bg-accent-contrast text-accent shadow-xs'
                        : 'left-[4px] w-4 h-4 bg-slate-500 dark:bg-slate-400'
                    }`}
                  >
                    {rememberAccount && (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </label>
          </div>

          {saveStatus && (
            <div className="p-3.5 rounded-2xl bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark text-xs font-medium border border-accent-border flex items-center gap-2 animate-fade-in">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{saveStatus}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[44px] px-8 rounded-full bg-accent hover:bg-accent-hover active:bg-accent-active text-accent-contrast font-medium text-sm transition-all shadow-xs hover:shadow flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span>Save Preferences</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </form>
      )}

      {/* Danger Zone */}
      {isLoading ? (
        <div
          className="p-6 sm:p-7 rounded-3xl border border-rose-200/80 dark:border-rose-950 bg-rose-50/30 dark:bg-rose-950/20 shadow-xs flex flex-col gap-4 animate-pulse"
          aria-label="Loading danger zone"
          data-testid="danger-zone-loading-skeleton"
        >
          <div className="h-5 w-28 rounded-full bg-rose-200/70 dark:bg-rose-900/50 mb-2" />
          <div className="h-3.5 w-80 max-w-full rounded-full bg-rose-200/50 dark:bg-rose-900/30 mb-4" />
          <div className="h-10 w-56 rounded-full bg-rose-200/60 dark:bg-rose-900/40" />
        </div>
      ) : (
        <div className="p-6 sm:p-7 rounded-3xl border border-rose-200/90 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 shadow-xs flex flex-col gap-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-rose-700 dark:text-rose-400">Danger Zone</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Permanently delete your account, session credentials, and revoke Google Drive OAuth permissions.
            </p>
          </div>

          {confirmDelete ? (
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 space-y-3.5">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 text-sm font-medium">
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Are you sure? This action cannot be undone.</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="min-h-[40px] py-2 px-6 rounded-full bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-sm font-medium transition-all shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Yes, Delete Account'}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[40px] py-2 px-5 rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="min-h-[40px] py-2 px-5 rounded-full bg-rose-600/10 hover:bg-rose-600/20 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-900/60 text-sm font-semibold transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-rose-500"
              >
                Delete Account & Revoke Access
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
