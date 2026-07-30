import './i18n';
import {lazy, StrictMode, Suspense, type ComponentType} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import LanguageSwitcher from './components/LanguageSwitcher.tsx';
import './index.css';

const pathname = window.location.pathname;
const isAdminRoute = pathname.startsWith('/admin');
let loadRootApp: () => Promise<{ default: ComponentType }>;

if (isAdminRoute) {
  loadRootApp = () => import('./admin/AdminApp.tsx');
} else if (pathname === '/methodology') {
  loadRootApp = () => import('./components/MethodologyPage.tsx');
} else if (pathname === '/about') {
  loadRootApp = () => import('./components/AboutPage.tsx');
} else if (pathname === '/privacy') {
  loadRootApp = () => import('./components/PrivacyPolicyPage.tsx');
} else if (pathname === '/terms') {
  loadRootApp = () => import('./components/TermsPage.tsx');
} else if (pathname.startsWith('/r/') || pathname.startsWith('/compare/')) {
  loadRootApp = () => import('./components/ReportViewer.tsx');
} else if (pathname === '/popular-ai-comparisons') {
  loadRootApp = () => import('./components/PopularComparisonsPage.tsx');
} else {
  loadRootApp = () => import('./App.tsx');
}

const RootApp = lazy(loadRootApp);

function PageLoadingFallback() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-neutral-300"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="animate-pulse">Loading page…</span>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {isAdminRoute ? null : <LanguageSwitcher />}
      <Suspense fallback={<PageLoadingFallback />}>
        <RootApp />
      </Suspense>
    </MotionConfig>
  </StrictMode>,
);
