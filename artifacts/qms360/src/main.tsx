import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { API_BASE } from '@/lib/deploy-config';

import './index.css';

// "" (the local-dev default) leaves customFetch's relative-path behavior
// unchanged; only a real split deploy (S3/CloudFront frontend, separate
// backend) sets VITE_API_BASE to something non-empty.
setBaseUrl(API_BASE || null);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // BASE_URL, not a hardcoded "/sw.js" -- under a versioned S3 subfolder
    // deploy (base: "/qms360/1.0.0/") the site doesn't live at the domain
    // root, so an absolute path would 404 / register with the wrong scope.
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => registration.update());
  });
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
