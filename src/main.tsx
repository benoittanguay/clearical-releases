import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StorageProvider } from './context/StorageContext.tsx'
import { SettingsProvider } from './context/SettingsContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <StorageProvider>
        <App />
      </StorageProvider>
    </SettingsProvider>
  </StrictMode>,
)
