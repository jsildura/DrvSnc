import React, { useState, useEffect } from 'react';
import { useApp } from '../state/AppProvider';
import {
  listRememberedAccounts,
  forgetRememberedAccount,
  getLoginUrlWithHint,
  RememberedAccount,
} from './rememberedAccounts';
import { LegalModal, LegalDocType } from '../components/LegalModal';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useApp();
  const [remembered, setRemembered] = useState<RememberedAccount[]>(() => listRememberedAccounts());
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocType>('terms');

  useEffect(() => {
    const sync = () => setRemembered(listRememberedAccounts());
    sync();
    window.addEventListener('gdu:remembered_accounts_changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('gdu:remembered_accounts_changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, [user]);

  const handleForget = (sub: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = forgetRememberedAccount(sub);
    setRemembered(updated);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </div>
          <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/30 to-blue-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/40 p-4">
        <div className="w-full max-w-md bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800 rounded-3xl p-8 shadow-2xl shadow-indigo-500/5">
          {/* Logo & Title */}
          <div className="flex flex-col items-center text-center mb-8">
            <img
              src="/icon.png"
              alt="CloudDrive Sync"
              className="w-16 h-16 rounded-2xl shadow-lg shadow-blue-500/25 mb-4 object-contain"
            />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              CloudDrive Sync
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Transfer large files directly to your Google Drive seamlessly
            </p>
          </div>

          {/* Remembered Accounts List */}
          {remembered.length > 0 && (
            <div className="mb-6 space-y-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                Choose an account
              </span>
              <div className="space-y-2 mt-2">
                {remembered.map((account) => (
                  <div
                    key={account.sub}
                    onClick={() => {
                      window.location.href = getLoginUrlWithHint(account);
                    }}
                    className="flex items-center justify-between p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/50 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99] group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {account.picture ? (
                        <img
                          src={account.picture}
                          alt={account.name || account.email}
                          className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">
                          {account.name ? account.name[0].toUpperCase() : account.email[0].toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {account.name || account.email}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {account.email}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleForget(account.sub, e)}
                      title="Forget account"
                      className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connect / Sign in Button */}
          <a
            href="/api/v1/auth/google/start"
            className="w-full flex items-center justify-center gap-3 py-3 px-6 rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131314] hover:bg-slate-50 dark:hover:bg-[#1f1f20] text-slate-800 dark:text-white font-medium text-sm shadow-sm hover:shadow transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{remembered.length > 0 ? 'Use another account' : 'Sign in with Google'}</span>
          </a>

          <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-6">
            By continuing, you grant permission to upload files directly into your Google Drive storage.
          </p>

          {/* Legal Footer Links */}
          <div className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-400 dark:text-slate-500">
            <button
              type="button"
              onClick={() => {
                setLegalDoc('terms');
                setShowLegalModal(true);
              }}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Terms of Service
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => {
                setLegalDoc('privacy');
                setShowLegalModal(true);
              }}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Privacy Policy
            </button>
          </div>
        </div>

        <LegalModal
          isOpen={showLegalModal}
          initialDoc={legalDoc}
          onClose={() => setShowLegalModal(false)}
        />
      </div>
    );
  }

  return <>{children}</>;
}
