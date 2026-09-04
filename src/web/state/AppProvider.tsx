import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AccountView, PreferencesView } from '../../shared/contracts';
import { apiRequest, setCsrfToken } from '../api/client';
import { rememberAccount, forgetRememberedAccount } from '../auth/rememberedAccounts';
import { AppTab, LOGIN_PATH, pathForTab, tabForPath } from './tabRoute';
import { SelectedDriveFile } from '../converter/types';

export type { AppTab } from './tabRoute';
export type ThemeMode = 'system' | 'light' | 'dark';

interface AppContextType {
  user: AccountView | null;
  preferences: PreferencesView | null;
  isLoading: boolean;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  pendingConverterFile: SelectedDriveFile | null;
  setPendingConverterFile: (file: SelectedDriveFile | null) => void;
  navigateToConverter: (file?: SelectedDriveFile | null) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  refreshSession: () => Promise<void>;
  updatePreferences: (patch: Partial<PreferencesView>) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (revokeGoogle?: boolean) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountView | null>(null);
  const [preferences, setPreferences] = useState<PreferencesView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTabState] = useState<AppTab>(() =>
    typeof window === 'undefined' ? 'uploader' : tabForPath(window.location.pathname)
  );
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('gdu_theme') as ThemeMode | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    }
    return 'system';
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingConverterFile, setPendingConverterFile] = useState<SelectedDriveFile | null>(null);

  // Tabs are real history entries, so Back returns to the previously viewed tab.
  // Only the path is passed to pushState, which also drops any stale query string
  // (e.g. the ?auth=success the OAuth callback leaves behind).
  const setActiveTab = useCallback((tab: AppTab) => {
    setActiveTabState(tab);
    if (typeof window === 'undefined') return;
    const target = pathForTab(tab);
    if (window.location.pathname !== target) {
      window.history.pushState({ tab }, '', target);
    }
  }, []);

  const navigateToConverter = useCallback(
    (file?: SelectedDriveFile | null) => {
      if (file) {
        setPendingConverterFile(file);
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('gdu_pending_converter_file', JSON.stringify(file));
          }
        } catch {
          // ignore
        }
      }
      setActiveTab('converter');
    },
    [setActiveTab]
  );

  useEffect(() => {
    // Deliberately setActiveTabState, not setActiveTab: reacting to Back/Forward
    // must not push a new entry of its own.
    const handlePopState = () => setActiveTabState(tabForPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const applyTheme = useCallback((mode: ThemeMode) => {
    if (typeof document === 'undefined') return;
    const isDark =
      mode === 'dark' ||
      (mode === 'system' &&
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', Boolean(isDark));
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gdu_theme', newTheme);
    }
    applyTheme(newTheme);
  }, [applyTheme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const refreshSession = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const sessionData = await apiRequest<{ user: AccountView | null; csrfToken?: string }>('/api/v1/session');
      if (sessionData.csrfToken) {
        setCsrfToken(sessionData.csrfToken);
      }
      if (sessionData.user) {
        setUser(sessionData.user);

        let prefData: PreferencesView | null = null;
        try {
          prefData = await apiRequest<PreferencesView>('/api/v1/preferences');
          setPreferences(prefData);
          if (prefData.themeMode) {
            setTheme(prefData.themeMode as ThemeMode);
          }
        } catch {
          // Defaults
        }

        if (prefData?.rememberAccount !== false) {
          rememberAccount({
            sub: sessionData.user.id,
            email: sessionData.user.email,
            name: sessionData.user.name,
            picture: sessionData.user.picture,
          });
        } else {
          forgetRememberedAccount(sessionData.user.id);
          forgetRememberedAccount(sessionData.user.email);
        }
      } else {
        setCsrfToken(null);
        setUser(null);
        setPreferences(null);
      }
    } catch {
      setCsrfToken(null);
      setUser(null);
      setPreferences(null);
    } finally {
      setIsLoading(false);
    }
  }, [setTheme]);

  useEffect(() => {
    refreshSession();

    const handleUnauthorized = () => {
      setCsrfToken(null);
      if (typeof document !== 'undefined') {
        document.cookie = 'gdu_csrf=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'gdu_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
      }
      setUser(null);
      setPreferences(null);
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        refreshSession();
      }
    };

    window.addEventListener('gdu:unauthorized', handleUnauthorized);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('gdu:unauthorized', handleUnauthorized);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [refreshSession]);

  // Keep the URL honest about what is on screen, once the session is known.
  // Covers: stripping the ?auth=success the OAuth callback leaves behind,
  // canonicalising "/" to /uploads, and dropping to /login on sign-out or session
  // expiry. replaceState, not pushState — none of these are navigations the user
  // should have to press Back through.
  //
  // The signed-in target comes from `activeTab`, not from the path, because
  // activeTab is what is actually rendered. On first mount the two agree (state is
  // seeded from the path, so deep links survive), but they can diverge if a session
  // is restored without a page load — the sign-out rewrite below has moved the path
  // to /login by then, and reading it back would strand the user on /uploads while
  // a different tab is on screen.
  useEffect(() => {
    if (isLoading || typeof window === 'undefined') return;
    const target = user ? pathForTab(activeTab) : LOGIN_PATH;
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [isLoading, user, activeTab]);

  const updatePreferences = useCallback(
    async (patch: Partial<PreferencesView>) => {
      const updated = await apiRequest<PreferencesView>('/api/v1/preferences', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setPreferences(updated);
      if (updated.themeMode) {
        setTheme(updated.themeMode as ThemeMode);
      }
      if (updated.rememberAccount === false && user) {
        forgetRememberedAccount(user.id);
        forgetRememberedAccount(user.email);
      } else if (updated.rememberAccount === true && user) {
        rememberAccount({
          sub: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
        });
      }
    },
    [setTheme, user]
  );

  const logout = useCallback(async () => {
    const currentUser = user;
    const currentPrefs = preferences;
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      try {
        await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } catch {
        // ignore
      }
    } finally {
      setCsrfToken(null);
      if (currentUser && currentPrefs?.rememberAccount === false) {
        forgetRememberedAccount(currentUser.id);
        forgetRememberedAccount(currentUser.email);
      }
      if (typeof document !== 'undefined') {
        document.cookie = 'gdu_csrf=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'gdu_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
      }
      setUser(null);
      setPreferences(null);
    }
  }, [user, preferences]);

  const deleteAccount = useCallback(
    async (revokeGoogle = true) => {
      const currentUser = user;
      try {
        await apiRequest('/api/v1/account', {
          method: 'DELETE',
          body: JSON.stringify({ revokeGoogleAccess: revokeGoogle }),
        });
      } catch {
        try {
          await fetch('/api/v1/account', { method: 'DELETE', credentials: 'same-origin' });
        } catch {
          // ignore
        }
      } finally {
        setCsrfToken(null);
        if (currentUser) {
          forgetRememberedAccount(currentUser.id);
          forgetRememberedAccount(currentUser.email);
        }
        if (typeof document !== 'undefined') {
          document.cookie = 'gdu_csrf=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
          document.cookie = 'gdu_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        }
        setUser(null);
        setPreferences(null);
      }
    },
    [user]
  );

  return (
    <AppContext.Provider
      value={{
        user,
        preferences,
        isLoading,
        activeTab,
        setActiveTab,
        pendingConverterFile,
        setPendingConverterFile,
        navigateToConverter,
        theme,
        setTheme,
        refreshSession,
        updatePreferences,
        logout,
        deleteAccount,
        error,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export function useOptionalApp() {
  return useContext(AppContext);
}
