import { createRoot } from 'react-dom/client'
import { App } from './App'
import { LanguageProvider } from './i18n/LanguageProvider'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')
createRoot(container).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
)
