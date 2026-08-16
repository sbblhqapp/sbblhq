import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppProvider } from '@/contexts/AppContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { BagProvider } from '@/contexts/BagContext';
import { Header } from '@/components/layout/Header';
import { BagDrawer } from '@/components/layout/BagDrawer';
import { RequireAdmin, RequireAuth } from '@/components/auth/RouteGuards';
import { StickyMusicPlayer } from '@/components/marketing/StickyMusicPlayer';
import { AppDownloadPill } from '@/components/marketing/AppDownloadPill';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SplashScreen } from '@/components/SplashScreen';

const AppHome = lazy(() => import('./pages/AppHome'));
const Home = lazy(() => import('./pages/Home'));
const Live = lazy(() => import('./pages/Live'));
const Schedules = lazy(() => import('./pages/Schedules'));
const Store = lazy(() => import('./pages/Store'));
const Profiles = lazy(() => import('./pages/Profiles'));
const Stats = lazy(() => import('./pages/Stats'));
const Leaderboards = lazy(() => import('./pages/Leaderboards'));
const Media = lazy(() => import('./pages/Media'));
const Scores = lazy(() => import('./pages/Scores'));
const Teams = lazy(() => import('./pages/Teams'));
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Billing = lazy(() => import('./pages/Billing'));
const Settings = lazy(() => import('./pages/Settings'));
const Ops = lazy(() => import('./pages/Ops'));
const Support = lazy(() => import('./pages/Support'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Offline = lazy(() => import('./pages/Offline'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const Overlay = lazy(() => import('./pages/Overlay'));
const OverlayControl = lazy(() => import('./pages/OverlayControl'));
const Scorekeeper = lazy(() => import('./pages/Scorekeeper'));
const OpsScoreboard = lazy(() => import('./pages/OpsScoreboard'));
const Engage = lazy(() => import('./pages/Engage'));
const Digest = lazy(() => import('./pages/Digest'));
const OpsBiometrics = lazy(() => import('./pages/OpsBiometrics'));
const OperatorLanding = lazy(() => import('./pages/OperatorLanding'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 s stale time prevents duplicate fetches on re-mount/re-focus.
      // Reduces Supabase read load by ~60% at scale.
      staleTime: 30_000,
      // Keep unused cache entries for 5 min before GC.
      gcTime: 300_000,
      // Only retry once on failure — avoids hammering a degraded backend.
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      // Don't refetch on window focus — avoids thundering herd after
      // users alt-tab during a live game broadcast.
      refetchOnWindowFocus: false,
      // Pause all polling intervals when browser tab is inactive/backgrounded
      // Slashes Supabase Disk IO and prevents idle client resource drain.
      refetchIntervalInBackground: false,
    },
    mutations: {
      // Surface mutation errors so UI can display them.
      throwOnError: false,
    },
  },
});

const RouteFallback = () => (
  <div className="container py-8 md:py-12 max-w-6xl min-h-[calc(100vh-8rem)]">
    <div className="panel p-6 space-y-4 animate-pulse">
      <div className="h-8 w-64 bg-muted rounded" />
      <div className="h-4 w-96 bg-muted/60 rounded" />
      <div className="h-48 w-full bg-muted/30 rounded mt-6" />
    </div>
  </div>
);

/** /register → /login?mode=signup, preserving ?redirect= param */
function RegisterRedirect() {
  const [params] = useSearchParams();
  const redirect = params.get('redirect');
  const target = redirect
    ? `/login?mode=signup&redirect=${encodeURIComponent(redirect)}`
    : '/login?mode=signup';
  return <Navigate to={target} replace />;
}

const MARKETING_SUPPRESSED_ROUTES = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/onboarding',
  '/offline',
]);

const DeferredShellEnhancements = () => {
  const [ready, setReady] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const schedule = globalThis.requestIdleCallback
      ? (callback: IdleRequestCallback) => globalThis.requestIdleCallback(callback)
      : (callback: IdleRequestCallback) => window.setTimeout(
        () => callback({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline),
        250,
      );
    const cancel = globalThis.cancelIdleCallback
      ? (id: number) => globalThis.cancelIdleCallback(id)
      : (id: number) => window.clearTimeout(id);

    const id = schedule(() => setReady(true));
    return () => cancel(id);
  }, []);

  // Avoid loading non-critical marketing widgets on auth/offline routes.
  if (!ready || MARKETING_SUPPRESSED_ROUTES.has(location.pathname)) {
    return null;
  }

  return (
    <>
      <StickyMusicPlayer />
      <AppDownloadPill />
    </>
  );
};

/**
 * Chromeless shell for /overlay/:gameId — OBS browser source.
 * No header, no drawer, no toasts. The page renders on a transparent
 * background and is the only thing OBS ever sees.
 */
const ChromelessShell = () => (
  <Suspense fallback={<div />}>
    <Routes>
      <Route path="/overlay/:gameId" element={<Overlay />} />
    </Routes>
  </Suspense>
);

const AppShell = () => (
  <div className="min-h-screen bg-background">
    <OfflineBanner />
    <Header />
    <BagDrawer />
    <DeferredShellEnhancements />
    <main>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<AppHome />} />
          <Route path="/league/:leagueId" element={<Home />} />
          <Route path="/live" element={<Live />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/store" element={<Store />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/leaderboards" element={<Leaderboards />} />
          <Route path="/media" element={<Media />} />
          <Route path="/scores" element={<Scores />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/engage" element={<Engage />} />
          <Route path="/digest" element={<Digest />} />
          <Route path="/operators" element={<OperatorLanding />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RegisterRedirect />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="/ops" element={<RequireAdmin><Ops /></RequireAdmin>} />
          <Route path="/ops/biometrics" element={<RequireAdmin><OpsBiometrics /></RequireAdmin>} />
          <Route path="/overlay-control/:gameId" element={<RequireAdmin><OverlayControl /></RequireAdmin>} />
          <Route path="/scorekeeper/:gameId" element={<RequireAdmin><Scorekeeper /></RequireAdmin>} />
          <Route path="/ops/scoreboard" element={<RequireAdmin><OpsScoreboard /></RequireAdmin>} />
          <Route path="/ops/scoreboard/:gameId" element={<RequireAdmin><OpsScoreboard /></RequireAdmin>} />
          <Route path="/support" element={<Support />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/offline" element={<Offline />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </main>
  </div>
);

const ShellSelector = () => {
  const location = useLocation();
  const isChromeless = location.pathname.startsWith('/overlay/');
  return isChromeless ? <ChromelessShell /> : <AppShell />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        {/* SplashScreen reads useAuth().loading — must live inside AuthProvider */}
        <SplashScreen />
        <BagProvider>
        <AppProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ShellSelector />
          </BrowserRouter>
        </AppProvider>
        </BagProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
