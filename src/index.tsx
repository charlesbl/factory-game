import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/app.css';
// Application entry selects a separately loaded review surface.
// eslint-disable-next-line react-refresh/only-export-components
const Gallery = lazy(() => import('./ui/WorldAssetGallery'));

const root = document.getElementById('root');
if (root === null) throw new Error('Application root is missing');
createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<p>Loading assets…</p>}>
      {new URLSearchParams(location.search).has('asset-gallery') ? (
        <Gallery />
      ) : (
        <App />
      )}
    </Suspense>
  </StrictMode>,
);
