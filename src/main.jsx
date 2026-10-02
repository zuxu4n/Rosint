import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { inject } from '@vercel/analytics';
if (window.location.hostname === 'www.rosint.dev') {
  const canonical = new URL(window.location.href);
  canonical.hostname = 'rosint.dev';
  window.location.replace(canonical.href);
} else {
  if (!/^\/(admin|removal)(\/|$)/.test(window.location.pathname)) inject();
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
