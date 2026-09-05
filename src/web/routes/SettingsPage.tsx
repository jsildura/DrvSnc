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
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your account preferences, appearance, upload templates, and Google Drive access.
        </p>
      </div>

      {/* Account Profile Card */}
      {isLoading ? (
        <div
          className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-4 animate-pulse"
          aria-label="Loading connected account"
          data-testid="account-loading-skeleton"
        >
          <div className="h-4 w-36 rounded bg-slate-200/80 dark:bg-slate-800/80" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-28 rounded bg-slate-200/80 dark:bg-slate-800/80" />
                  <div className="h-4 w-16 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
                </div>
                <div className="h-3 w-40 rounded bg-slate-200/50 dark:bg-slate-800/50" />
              </div>
            </div>
            <div className="h-9 w-24 rounded-xl bg-slate-200/60 dark:bg-slate-800/60 shrink-0" />
          </div>
        </div>
      ) : (
        <div className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Connected Account</h3>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt={user.name || user.email}
                  className="w-12 h-12 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-lg">
                  {user?.name ? user.name[0].toUpperCase() : user?.email[0].toUpperCase()}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{user?.name}</p>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                    Connected
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="py-2 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors shrink-0"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Seedr.cc Cloud Torrent Integration Card */}
      {seedrLoading ? (
        <div
          className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-4 animate-pulse"
          aria-label="Loading Seedr settings"
          data-testid="seedr-loading-skeleton"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="h-5 w-48 rounded bg-slate-200/80 dark:bg-slate-800/80 mb-1.5" />
              <div className="h-3.5 w-64 sm:w-80 rounded bg-slate-200/50 dark:bg-slate-800/50" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-6 w-20 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
              <div className="h-6 w-32 rounded-full bg-slate-200/60 dark:bg-slate-800/60" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="h-4 w-48 sm:w-56 rounded bg-slate-200/60 dark:bg-slate-800/60" />
            <div className="h-8 w-28 rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
          </div>
        </div>
      ) : (
        <div className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Seedr.cc Torrent Downloader
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Powers remote Magnet link & torrent file downloads directly to Google Drive.
              </p>
            </div>

            {seedrStatus.connected && (
              <div className="flex items-center gap-2">
                {seedrStatus.isPremium ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50 uppercase tracking-wider">
                    ★ {seedrStatus.packageName || 'Premium'}
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Non-Premium
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 w-fit">
                  Connected ({formatBytes(seedrStatus.spaceUsed)} / {formatBytes(seedrStatus.spaceMax)})
                </span>
              </div>
            )}
          </div>

          {seedrStatus.connected ? (
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Account:</span> {seedrStatus.username || seedrStatus.email || 'Seedr User'} ({seedrStatus.isPremium ? seedrStatus.packageName || 'Premium' : 'Free Tier'})
              </div>
              <button
                type="button"
                onClick={handleDisconnectSeedr}
                className="py-1.5 px-3 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors"
              >
                Disconnect Seedr
              </button>
            </div>
          ) : (
            <form onSubmit={handleSeedrLogin} className="space-y-3 pt-1 max-w-md">
              <div className="space-y-2">
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
                    className="mt-1 w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className="mt-1 w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSeedrLoggingIn || !seedrEmail.trim() || !seedrPassword.trim()}
                  className="py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-2"
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
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 underline font-medium"
                >
                  Register free
                </a>
              </div>
            </form>
          )}

          {seedrActionMsg && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{seedrActionMsg}</p>
          )}
          {seedrErrorMsg && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{seedrErrorMsg}</p>
          )}
        </div>
      )}

      {/* Appearance Card */}
      {isLoading ? (
        <div
          className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-6 animate-pulse"
          aria-label="Loading appearance settings"
          data-testid="appearance-loading-skeleton"
        >
          <div>
            <div className="h-5 w-28 rounded bg-slate-200/80 dark:bg-slate-800/80 mb-1.5" />
            <div className="h-3.5 w-72 rounded bg-slate-200/50 dark:bg-slate-800/50 mb-3" />
            <div className="h-3.5 w-20 rounded bg-slate-200/70 dark:bg-slate-800/70 mb-2" />
            <div className="grid grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-11 rounded-2xl bg-slate-200/60 dark:bg-slate-800/60" />
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="h-3.5 w-24 rounded bg-slate-200/70 dark:bg-slate-800/70 mb-1" />
                <div className="h-3 w-80 max-w-full rounded bg-slate-200/50 dark:bg-slate-800/50" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 pt-1.5">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-6">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">Appearance</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Choose how the application and themes look on your device.</p>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Theme Mode</label>
            <div className="grid grid-cols-3 gap-3">
              {(['system', 'light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setTheme(mode);
                    updatePreferences({ themeMode: mode }).catch((err) => {
                      console.error('Failed to update theme mode on server:', err);
                    });
                  }}
                  className={`p-3 rounded-2xl border text-sm font-medium capitalize transition-all ${theme === mode
                    ? 'border-accent bg-accent-light dark:bg-accent-dark text-accent dark:text-accent-textDark shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Color Customization */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
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
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline transition-colors"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Preset Swatches & Custom Picker */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1.5">
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
                    className={`group relative w-8 h-8 rounded-full flex items-center justify-center transition-all ${isSelected
                      ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900 scale-110 shadow-sm'
                      : 'hover:scale-105 opacity-90 hover:opacity-100'
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
                  className="w-8 h-8 rounded-full border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 overflow-hidden relative shadow-xs transition-all"
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
          className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-4 animate-pulse"
          aria-label="Loading upload preferences"
          data-testid="upload-preferences-loading-skeleton"
        >
          <div className="h-5 w-40 rounded bg-slate-200/80 dark:bg-slate-800/80" />

          <div>
            <div className="h-3.5 w-36 rounded bg-slate-200/70 dark:bg-slate-800/70 mb-1.5" />
            <div className="h-10 w-full rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
            <div className="h-3 w-56 rounded bg-slate-200/50 dark:bg-slate-800/50 mt-1.5" />
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
              <div className="h-4 w-64 rounded bg-slate-200/60 dark:bg-slate-800/60" />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded bg-slate-200/80 dark:bg-slate-800/80 shrink-0" />
              <div className="h-4 w-60 rounded bg-slate-200/60 dark:bg-slate-800/60" />
            </div>
          </div>

          <div className="h-10 w-full rounded-xl bg-slate-200/70 dark:bg-slate-800/70" />
        </div>
      ) : (
        <form
          onSubmit={handleSavePreferences}
          className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm space-y-4"
        >
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Upload Preferences</h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Filename Template Pattern
            </label>
            <input
              type="text"
              value={filenamePattern}
              onChange={(e) => setFilenamePattern(e.target.value)}
              placeholder="{filename}"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Use variables like {'{filename}'}, {'{date}'}, or {'{timestamp}'}
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Enable transfer completion notifications
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberAccount}
                onChange={(e) => setRememberAccount(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Remember account hint on this device
              </span>
            </label>
          </div>

          {saveStatus && (
            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{saveStatus}</p>
          )}

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium shadow-sm transition-colors"
          >
            Save Preferences
          </button>
        </form>
      )}

      {/* Danger Zone */}
      {isLoading ? (
        <div
          className="p-6 rounded-3xl border border-rose-200/80 dark:border-rose-950 bg-rose-50/30 dark:bg-rose-950/20 backdrop-blur-xl shadow-sm animate-pulse"
          aria-label="Loading danger zone"
          data-testid="danger-zone-loading-skeleton"
        >
          <div className="h-5 w-28 rounded bg-rose-200/70 dark:bg-rose-900/50 mb-2" />
          <div className="h-3.5 w-80 max-w-full rounded bg-rose-200/50 dark:bg-rose-900/30 mb-4" />
          <div className="h-9 w-56 rounded-xl bg-rose-200/60 dark:bg-rose-900/40" />
        </div>
      ) : (
        <div className="p-6 rounded-3xl border border-rose-200/80 dark:border-rose-950 bg-rose-50/30 dark:bg-rose-950/20 backdrop-blur-xl shadow-sm">
          <h3 className="text-base font-semibold text-rose-600 dark:text-rose-400 mb-1">Danger Zone</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Permanently delete your account, session credentials, and revoke Google Drive OAuth permissions.
          </p>

          {confirmDelete ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                Are you sure? This action cannot be undone.
              </p>
              <div className="flex items-center gap-3">
                <button
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition-colors"
                >
                  {isDeleting ? 'Deleting...' : 'Yes, Delete Account'}
                </button>
                <button
                  disabled={isDeleting}
                  onClick={() => setConfirmDelete(false)}
                  className="py-2 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="py-2 px-4 rounded-xl bg-rose-600/10 hover:bg-rose-600/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 text-sm font-medium transition-colors"
            >
              Delete Account & Revoke Access
            </button>
          )}
        </div>
      )}
    </div>
  );
}
