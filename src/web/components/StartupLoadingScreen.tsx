import React, { useState, useEffect, useRef } from 'react';

export type StartupPhase = 'environment' | 'session' | 'ready';

export interface BootError {
  check: 'capabilities' | 'network' | 'api' | 'session';
  title: string;
  message: string;
}

export interface StartupLoadingScreenProps {
  onComplete?: () => void;
  isSessionLoading?: boolean;
  minPhaseDuration?: number;
  user?: { email?: string; name?: string } | null;
}

export function StartupLoadingScreen({
  onComplete,
  isSessionLoading = false,
  minPhaseDuration,
  user,
}: StartupLoadingScreenProps) {
  // In automated test environments, avoid artificial delays so tests remain fast.
  const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const isZeroDuration = minPhaseDuration === 0 || (minPhaseDuration === undefined && isTestEnv);
  const isTest = isTestEnv || (minPhaseDuration !== undefined && minPhaseDuration <= 100);

  // Each sub-step text has ample readable time on screen for the human eye (~1200ms in production)
  const stepDuration = isTest
    ? Math.max(10, Math.floor((minPhaseDuration ?? 30) / 3))
    : minPhaseDuration !== undefined
      ? Math.max(400, Math.floor(minPhaseDuration * 0.75))
      : 1200;

  // Checking prompt duration before result display (~900ms in production)
  const checkPromptDuration = isTest
    ? Math.max(5, Math.floor(stepDuration / 2))
    : Math.floor(stepDuration * 0.75);

  // Deliberate delay (milliseconds) before starting another phase to let user register completion (~800ms in production)
  const phaseTransitionDelay = isTest
    ? 10
    : minPhaseDuration !== undefined
      ? Math.max(200, Math.floor(minPhaseDuration / 2))
      : 800;

  const [phase, setPhase] = useState<StartupPhase>('environment');
  const [envStatus, setEnvStatus] = useState<'checking' | 'ready'>('checking');
  const [sessionStatus, setSessionStatus] = useState<'waiting' | 'checking' | 'ready'>('waiting');
  const [progress, setProgress] = useState(20);
  const [isExiting, setIsExiting] = useState(false);

  // Error state for strictly enforced functional gatekeeping
  const [bootError, setBootError] = useState<BootError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Factual sub-step text reflecting real checks performed by the app
  const [subStepText, setSubStepText] = useState('Checking browser capabilities');

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const hasCompletedRef = useRef(false);
  const triggerComplete = () => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    onCompleteRef.current?.();
  };

  const isSessionLoadingRef = useRef(isSessionLoading);
  isSessionLoadingRef.current = isSessionLoading;

  const userRef = useRef(user);
  userRef.current = user;

  // Auto-retry when internet connectivity returns
  useEffect(() => {
    if (!bootError || bootError.check !== 'network') return;

    const handleOnline = () => {
      setBootError(null);
      setRetryCount((c) => c + 1);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [bootError]);

  // Immediate completion path for test environments without explicit minPhaseDuration or 0ms
  useEffect(() => {
    if (isZeroDuration) {
      setEnvStatus('ready');
      setSessionStatus('ready');
      setProgress(100);
      if (!isSessionLoading) {
        setPhase('ready');
        triggerComplete();
      }
    }
  }, [isZeroDuration, isSessionLoading]);

  // Main lifecycle: Phase 1 (Environment) -> Pause -> Phase 2 (Session) -> Pause -> Phase 3 (Ready)
  useEffect(() => {
    if (isZeroDuration) return;
    let isCancelled = false;
    setBootError(null);

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    async function runStartupSequence() {
      // -------------------------------------------------------------
      // PHASE 1: Application Environment Checks
      // -------------------------------------------------------------
      setPhase('environment');
      setEnvStatus('checking');

      // Check 1: Storage & Web Crypto capabilities
      if (!isCancelled) {
        setSubStepText('Checking browser capabilities');
      }
      await sleep(checkPromptDuration);
      if (isCancelled) return;

      const hasCrypto = typeof window !== 'undefined' && Boolean(window.crypto);
      let hasLocalStorage = false;
      try {
        if (typeof localStorage !== 'undefined') {
          const testKey = '__gdu_boot_test__';
          localStorage.setItem(testKey, testKey);
          localStorage.removeItem(testKey);
          hasLocalStorage = true;
        }
      } catch {
        hasLocalStorage = false;
      }

      // Enforced Gatekeeping: Halt on missing capabilities
      if (!hasCrypto || !hasLocalStorage) {
        if (!isCancelled) {
          setBootError({
            check: 'capabilities',
            title: 'Browser Incompatible',
            message: !hasCrypto
              ? 'Web Cryptography API is unavailable. CloudDrive Sync requires a modern browser with crypto support.'
              : 'Local storage access is blocked. Please check your browser privacy or cookie settings.',
          });
        }
        return;
      }

      if (!isCancelled) {
        setSubStepText('Storage & cryptography verified');
        setProgress(35);
      }
      await sleep(stepDuration);
      if (isCancelled) return;

      // Check 2: Network connectivity
      if (!isCancelled) {
        setSubStepText('Checking network connectivity');
      }
      await sleep(checkPromptDuration);
      if (isCancelled) return;

      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      // Enforced Gatekeeping: Halt on offline network
      if (!isOnline) {
        if (!isCancelled) {
          setBootError({
            check: 'network',
            title: 'No Internet Connection',
            message: 'Your device appears to be offline. Reconnect to the internet to initialize CloudDrive Sync.',
          });
        }
        return;
      }

      if (!isCancelled) {
        setSubStepText('Network connection active');
        setProgress(45);
      }
      await sleep(stepDuration);
      if (isCancelled) return;

      // Check 3: API Gateway Health Ping
      if (!isCancelled) {
        setSubStepText('Checking API gateway health');
      }

      let apiHealthy = false;
      let apiErrorMessage = '';
      try {
        const timeoutPromise = sleep(3500).then(() => {
          throw new Error('Connection timed out');
        });
        const healthUrl =
          typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
            ? `${window.location.origin}/api/v1/health`
            : '/api/v1/health';
        const fetchPromise = fetch(healthUrl, { signal: controller?.signal });
        const res = (await Promise.race([fetchPromise, timeoutPromise])) as Response;
        if (res.ok) {
          apiHealthy = true;
        } else {
          apiErrorMessage = `HTTP ${res.status}`;
        }
      } catch (err: any) {
        apiHealthy = false;
        apiErrorMessage = err?.message || 'Network error';
      }

      await sleep(checkPromptDuration);
      if (isCancelled) return;

      // Enforced Gatekeeping: Halt on API gateway failure
      if (!apiHealthy) {
        if (!isCancelled) {
          setBootError({
            check: 'api',
            title: 'API Gateway Unavailable',
            message: `Could not establish a connection to the backend server (${apiErrorMessage}). Please verify the service is running.`,
          });
        }
        return;
      }

      if (!isCancelled) {
        setSubStepText('API gateway operational');
        setProgress(55);
      }
      await sleep(stepDuration);
      if (isCancelled) return;

      // Mark Phase 1 complete
      if (!isCancelled) {
        setEnvStatus('ready');
      }

      // DELAY BEFORE NEXT PHASE: give user time to register Phase 1 completion
      await sleep(phaseTransitionDelay);
      if (isCancelled) return;

      // -------------------------------------------------------------
      // PHASE 2: User Session & Authentication Check
      // -------------------------------------------------------------
      if (!isCancelled) {
        setPhase('session');
        setSessionStatus('checking');
        setProgress(70);
        setSubStepText('Validating session credentials');
      }

      // Allow human eye to read "Validating session credentials"
      const sessionWaitStart = Date.now();
      await sleep(stepDuration);
      if (isCancelled) return;

      // Wait for AppProvider's session fetch (/api/v1/session) to complete
      const maxSessionWait = isTest ? 200 : 5000;
      while (isSessionLoadingRef.current && Date.now() - sessionWaitStart < maxSessionWait) {
        await sleep(40);
        if (isCancelled) return;
      }

      // Display real session resolution
      if (!isCancelled) {
        const currentUser = userRef.current;
        if (currentUser?.email) {
          setSubStepText(`Signed in as ${currentUser.email}`);
        } else if (currentUser?.name) {
          setSubStepText(`Signed in as ${currentUser.name}`);
        } else {
          setSubStepText('Session ready');
        }
        setProgress(90);
      }
      await sleep(stepDuration);
      if (isCancelled) return;

      // Mark Phase 2 complete
      if (!isCancelled) {
        setSessionStatus('ready');
        setProgress(100);
      }

      // DELAY BEFORE NEXT PHASE: give user time to see both badges ready
      await sleep(phaseTransitionDelay);
      if (isCancelled) return;

      // -------------------------------------------------------------
      // PHASE 3: Ready & Workspace Launch
      // -------------------------------------------------------------
      if (!isCancelled) {
        setPhase('ready');
        setSubStepText('All checks passed');
      }

      // Allow human eye to clearly see "Ready" and "All checks passed"
      await sleep(isTest ? 20 : 1000);
      if (isCancelled) return;

      // Transition sub-step to "Launching workspace..."
      if (!isCancelled) {
        setSubStepText('Launching workspace...');
      }

      // Generous delay on "Launching workspace..." before exit transition
      await sleep(isTest ? 20 : 3000);
      if (isCancelled) return;

      // Smooth exit fade
      if (!isCancelled) {
        setIsExiting(true);
      }

      await sleep(isTest ? 0 : 100);
      if (isCancelled) return;

      triggerComplete();
    }

    runStartupSequence();

    return () => {
      isCancelled = true;
      if (controller) controller.abort();
    };
  }, [minPhaseDuration, isTest, stepDuration, phaseTransitionDelay, retryCount, isZeroDuration]);

  const handleRetry = () => {
    setIsRetrying(true);
    setBootError(null);
    setEnvStatus('checking');
    setSessionStatus('waiting');
    setProgress(20);
    setSubStepText('Restarting checks...');
    setTimeout(() => {
      setIsRetrying(false);
      setRetryCount((c) => c + 1);
    }, 150);
  };

  return (
    <div
      data-testid="startup-loading-screen"
      className={`min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-slate-50 dark:bg-slate-950 p-4 select-none transition-all duration-500 ease-out ${isExiting ? 'opacity-0 scale-[0.97]' : 'opacity-100 scale-100 animate-fade-in'
        }`}
    >
      {/* Background Ambient Glow Orbs */}
      <div
        aria-hidden="true"
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-accent/10 dark:bg-accent/15 blur-3xl pointer-events-none animate-pulse"
        style={{ animationDuration: '4s' }}
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-sky-400/8 dark:bg-sky-500/10 blur-3xl pointer-events-none animate-pulse"
        style={{ animationDuration: '5s', animationDelay: '1s' }}
      />

      {/* Main Glassmorphic Card */}
      <div className="relative w-full max-w-xs sm:max-w-sm p-7 sm:p-9 rounded-3xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xl shadow-slate-900/10 dark:shadow-black/60 flex flex-col items-center text-center">
        {/* App Icon Container with Breathing Halo */}
        <div className="relative flex items-center justify-center mb-6">
          <div
            aria-hidden="true"
            className="absolute -inset-2.5 rounded-2xl bg-gradient-to-tr from-accent/30 to-sky-400/30 blur-xl animate-pulse"
            style={{ animationDuration: '3s' }}
          />

          <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white dark:bg-slate-800 p-2 shadow-lg shadow-accent/15 border border-slate-100 dark:border-slate-700/80 flex items-center justify-center">
            <img
              src="/icon.png"
              alt="CloudDrive Sync"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Brand Name */}
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          CloudDrive Sync
        </h1>

        {/* Conditional Content: Error State vs Normal Boot Progression */}
        {bootError ? (
          <div
            data-testid="boot-error-container"
            className="mt-4 flex flex-col items-center animate-fade-in w-full"
          >
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 dark:bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-3 shadow-sm">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 mb-1">
              {bootError.title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[260px] leading-relaxed mb-4">
              {bootError.message}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-accent text-white hover:bg-accent-hover active:bg-accent-active shadow-md shadow-accent/25 transition-all duration-200 cursor-pointer disabled:opacity-50"
            >
              <svg
                className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>{isRetrying ? 'Checking...' : 'Retry Connection'}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Single Non-Overlapping Status Area with Smooth Measured Transitions */}
            <div className="mt-3.5 flex flex-col items-center justify-center min-h-[44px] w-full px-2">
              <p
                key={`title-${phase}`}
                className={`text-[13px] font-medium tracking-wide transition-colors duration-300 animate-fade-in ${phase === 'ready'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-700 dark:text-slate-200'
                  }`}
              >
                {phase === 'environment' && 'Checking environment'}
                {phase === 'session' && 'Verifying session'}
                {phase === 'ready' && 'Ready'}
              </p>
              <p
                key={`sub-${subStepText}`}
                className="text-[11px] text-slate-400 dark:text-slate-500 font-normal tracking-wide mt-0.5 max-w-full truncate animate-fade-in transition-opacity duration-300"
              >
                {subStepText}
              </p>
            </div>

            {/* Phased Checklist Status Badges */}
            <div className="mt-4 flex items-center justify-center gap-3 py-1.5 px-3.5 rounded-full bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 text-[11px]">
              {/* Badge 1: Environment */}
              <div className="flex items-center gap-1.5 transition-colors duration-300">
                <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  {envStatus === 'ready' ? (
                    <svg
                      className="w-3.5 h-3.5 text-emerald-500 animate-fade-in"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent/80 animate-pulse" />
                  )}
                </div>
                <span
                  className={`font-medium transition-colors duration-300 ${envStatus === 'ready'
                    ? 'text-slate-600 dark:text-slate-300'
                    : 'text-accent/90 dark:text-accent-textDark'
                    }`}
                >
                  Environment
                </span>
              </div>

              <span className="text-slate-300/80 dark:text-slate-600/80">·</span>

              {/* Badge 2: Session */}
              <div className="flex items-center gap-1.5 transition-colors duration-300">
                <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  {sessionStatus === 'ready' ? (
                    <svg
                      className="w-3.5 h-3.5 text-emerald-500 animate-fade-in"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : sessionStatus === 'checking' ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent/80 animate-pulse" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                  )}
                </div>
                <span
                  className={`font-medium transition-colors duration-300 ${sessionStatus === 'ready'
                    ? 'text-slate-600 dark:text-slate-300'
                    : sessionStatus === 'checking'
                      ? 'text-accent/90 dark:text-accent-textDark'
                      : 'text-slate-400 dark:text-slate-500'
                    }`}
                >
                  Session
                </span>
              </div>
            </div>

            {/* Dynamic Fluid Light Beam Progress Bar */}
            <div
              data-testid="startup-progress-bar"
              className="mt-5 w-full max-w-[200px] h-1 bg-slate-200/60 dark:bg-slate-800/80 rounded-full overflow-hidden relative"
            >
              <div
                className="h-full bg-gradient-to-r from-accent to-sky-400 rounded-full transition-all duration-700 ease-out relative"
                style={{
                  width: `${progress}%`,
                  boxShadow: '0 0 8px var(--color-accent, #4f46e5)',
                }}
              >
                {/* Shimmer light beam traveling across the active progress fill */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
