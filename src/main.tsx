import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { router } from '@/routes/router';
import { initServiceWorkerUpdates } from '@/lib/swUpdate';
import '@/styles/app.css';

// Detect and apply new deployments without an uninstall/reinstall.
initServiceWorkerUpdates();

const el = document.getElementById('root');
if (!el) throw new Error('Root element #root not found');

createRoot(el).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
