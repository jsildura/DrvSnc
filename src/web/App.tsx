import React, { useState } from 'react';
import { AppProvider, useApp, AppTab } from './state/AppProvider';
import { AuthGate } from './auth/AuthGate';
import { UploaderPage } from './routes/UploaderPage';
import { DrivePage } from './routes/DrivePage';
import { ConverterPage } from './routes/ConverterPage';
import { SettingsPage } from './routes/SettingsPage';
import { LegalModal, LegalDocType } from './components/LegalModal';
import { AboutModal } from './components/AboutModal';

function DashboardShell() {
  const { user, activeTab, setActiveTab } = useApp();
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocType>('terms');

  const navItems: { id: AppTab; label: string; icon: (props: { className?: string }) => JSX.Element }[] = [
    {
      id: 'uploader',
      label: 'Uploads',
      icon: ({ className }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      ),
    },
    {
      id: 'drive',
      label: 'Drive',
      icon: ({ className }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      ),
    },
    {
      id: 'converter',
      label: 'Converter',
      icon: ({ className }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 w-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <img
              src="/icon.png"
              alt="CloudDrive Sync"
              className="w-9 h-9 rounded-xl shadow-sm object-contain"
            />
            <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white hidden sm:inline-block">
              CloudDrive Sync
            </span>
          </div>

          {/* Desktop Nav Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/60 p-1 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-accent dark:text-accent-textDark shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Header Controls: Theme & User Avatar */}
          <div className="flex items-center gap-3">
            {/* About / Info Button */}
            <button
              onClick={() => setShowAboutModal(true)}
              title="About"
              aria-label="About"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>

            {user && (
              <div
                role="button"
                tabIndex={0}
                title="Settings"
                aria-label="User profile settings"
                onClick={() => setActiveTab('settings')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('settings');
                  }
                }}
                className={`flex items-center gap-2 rounded-full sm:rounded-2xl cursor-pointer transition-all border ${
                  activeTab === 'settings'
                    ? 'bg-slate-200/80 dark:bg-slate-800 border-accent'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
              >
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name || user.email}
                    className={`w-8 h-8 rounded-full border object-cover transition-colors ${
                      activeTab === 'settings'
                        ? 'border-accent'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs">
                    {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
                  </div>
                )}
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 hidden sm:inline-block max-w-[120px] truncate pr-2.5">
                  {user.name || user.email}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main App Content View */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-6 lg:px-8 py-4 sm:py-8 mb-16 md:mb-0">
        {activeTab === 'uploader' && <UploaderPage />}
        {activeTab === 'drive' && <DrivePage />}
        {activeTab === 'converter' && <ConverterPage />}
        {activeTab === 'settings' && <SettingsPage />}

        {/* Global Footer */}
        <footer className="mt-12 pt-6 border-t border-slate-200/60 dark:border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 dark:text-slate-500">
          <p>© {new Date().getFullYear()} CloudDrive Sync. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setLegalDoc('terms');
                setShowLegalModal(true);
              }}
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
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
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              Privacy Policy
            </button>
          </div>
        </footer>
      </main>

      <LegalModal
        isOpen={showLegalModal}
        initialDoc={legalDoc}
        onClose={() => setShowLegalModal(false)}
      />

      <AboutModal
        isOpen={showAboutModal}
        onClose={() => setShowAboutModal(false)}
      />

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/65 dark:bg-slate-900/65 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.45)] pb-[env(safe-area-inset-bottom,0px)]">
        <div className="grid grid-cols-3 h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                  isActive
                    ? 'text-accent dark:text-accent-textDark font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AuthGate>
        <DashboardShell />
      </AuthGate>
    </AppProvider>
  );
}

export default App;
