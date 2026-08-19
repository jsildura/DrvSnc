import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AccountView, PreferencesView } from '../../shared/contracts';
import { apiRequest, setCsrfToken } from '../api/client';
import { rememberAccount, forgetRememberedAccount } from '../auth/rememberedAccounts';

export type AppTab = 'uploader' | 'drive' | 'settings';
export type ThemeMode = 'system' | 'light' | 'dark';

interface AppContextType {
  user: AccountView | null;
  preferences: PreferencesView | null;
  isLoading: boolean;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
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
  const [activeTab, setActiveTab] = useState<AppTab>('uploader');
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('gdu_theme') as ThemeMode | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    }
    return 'system';
  });
  const [error, setError] = useState<string | null>(null);

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
