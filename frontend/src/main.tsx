import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const splash = document.getElementById('gq-splash')
if (splash) {
  const hide = () => {
    splash.classList.add('is-hidden')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    window.setTimeout(() => splash.remove(), 800)
  }
  window.setTimeout(hide, 2700)
}
