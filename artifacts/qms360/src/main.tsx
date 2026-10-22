import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { API_BASE } from '@/lib/deploy-config';

import './index.css';

// "" (the local-dev default) leaves customFetch's relative-path behavior
// unchanged; only a real split deploy (S3/CloudFront frontend, separate
// backend) sets VITE_API_BASE to something non-empty. Orthogonal to the
// drona build's relative-asset-path fix below -- this is API connectivity,
// that's asset loading.
setBaseUrl(API_BASE || null);

// Service worker registration disabled: 1.0.6 (last confirmed-working
// version on both web and the DronaHQ mobile container) never ran one.
// Its 'navigate' fetch handler is what actually produced the 404/network
// error on internal route navigations (e.g. /login) under this versioned
// S3/CloudFront deploy, where no object exists outside index.html/assets.
// Revisit if offline support is genuinely needed, with the fetch handler
// scoped correctly for a non-root, versioned deploy path.
//
// Any device/browser that already loaded an earlier build (which did
// register one) keeps that old registration active indefinitely -- simply
// no longer registering here doesn't replace or remove it, since nothing
// prompts the browser to check. Clean it up unconditionally so this can't
// keep silently breaking the app on devices that hit a prior version.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister();
  });
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
