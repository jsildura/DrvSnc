import React, { useState } from 'react';

export type LegalDocType = 'terms' | 'privacy';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDoc?: LegalDocType;
}

export function LegalModal({ isOpen, onClose, initialDoc = 'terms' }: LegalModalProps) {
  const [activeDoc, setActiveDoc] = useState<LegalDocType>(initialDoc);

  // Sync initialDoc when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setActiveDoc(initialDoc);
    }
  }, [isOpen, initialDoc]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-md animate-fade-in">
      <div
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl shadow-2xl shadow-slate-900/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          {/* Navigation Pill Toggle */}
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
            <button
              onClick={() => setActiveDoc('terms')}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeDoc === 'terms'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Terms of Service
            </button>
            <button
              onClick={() => setActiveDoc('privacy')}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeDoc === 'privacy'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Privacy Policy
            </button>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
          {activeDoc === 'terms' ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Terms of Service</h2>
                <p className="text-xs text-slate-400 mt-1">Last Updated: August 2026</p>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">1. Acceptance of Terms</h3>
                <p>
                  By accessing or using CloudDrive Sync (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">2. Description of Service</h3>
                <p>
                  CloudDrive Sync provides a client and cloud pipeline enabling users to upload files and remote URLs directly into their personal Google Drive accounts using authorized Google OAuth 2.0 credentials.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">3. User Responsibilities & Acceptable Use</h3>
                <p>
                  You are solely responsible for all content uploaded via the Service. You agree not to use the Service to:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>Upload or transmit any unlawful, harmful, threatening, infringing, or malicious material.</li>
                  <li>Circumvent Google Drive storage quotas, API rate limits, or Google Terms of Service.</li>
                  <li>Attempt unauthorized access to any system, server, or cloud storage infrastructure.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">4. Account Termination & Token Revocation</h3>
                <p>
                  You may disconnect the Service or permanently delete your account at any time via Settings. Deleting your account immediately revokes all Google OAuth refresh tokens, terminates server sessions, and clears stored preferences.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">5. Disclaimer of Warranties</h3>
                <p>
                  The Service is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without warranties of any kind, whether express or implied. We do not guarantee uninterrupted or error-free transmission of files.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">6. Limitation of Liability</h3>
                <p>
                  In no event shall CloudDrive Sync or its contributors be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the Service.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Privacy Policy</h2>
                <p className="text-xs text-slate-400 mt-1">Last Updated: August 2026</p>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">1. Core Privacy Commitment</h3>
                <p>
                  CloudDrive Sync is designed with strict privacy principles. We do not sell, rent, monetize, or share your personal information or Google Drive data with third parties.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">2. Google User Data & OAuth Scopes</h3>
                <p>
                  When you sign in with Google, we request access to your account to facilitate file transfers:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>
                    <strong className="text-slate-800 dark:text-slate-200">drive.file:</strong> Grants access only to files and folders created or opened by this application.
                  </li>
                  <li>
                    <strong className="text-slate-800 dark:text-slate-200">drive.metadata.readonly:</strong> Allows listing folders and quota metadata so you can select upload destinations.
                  </li>
                  <li>
                    <strong className="text-slate-800 dark:text-slate-200">userinfo.email & profile:</strong> Used solely to display your active account identity in the interface.
                  </li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">3. Security & Token Encryption</h3>
                <p>
                  OAuth refresh tokens are encrypted server-side using industry-standard AES-256-GCM encryption with per-user isolated keys. Session tokens are hashed and stored securely with <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">HttpOnly</code>, <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">SameSite=Lax</code> cookie flags.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">4. Temporary File Staging & Retention</h3>
                <p>
                  Files uploaded via multipart chunking are temporarily staged in private encrypted storage and streamed directly to Google Drive. Staged temporary parts are automatically purged upon transfer completion or within 24 hours under our automated cleanup cron.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">5. Your Data Rights & Deletion</h3>
                <p>
                  You have full control over your data. You can delete your account and revoke Google Drive authorization at any moment under <strong className="text-slate-800 dark:text-slate-200">Settings &gt; Danger Zone</strong>, which immediately deletes all sessions and credentials.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">6. Google API Services Disclosure</h3>
                <p>
                  CloudDrive Sync&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
                  <a
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-500"
                  >
                    Google API Services User Data Policy
                  </a>
                  , including the Limited Use requirements.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
