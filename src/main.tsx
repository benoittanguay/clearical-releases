import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StorageProvider } from './context/StorageContext.tsx'
import { SettingsProvider } from './context/SettingsContext.tsx'
import { ToastProvider } from './context/ToastContext.tsx'

// Import seed script to expose console commands in development
if (import.meta.env.DEV) {
  import('./utils/seedScript');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <StorageProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </StorageProvider>
    </SettingsProvider>
  </StrictMode>,
)
