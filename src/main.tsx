import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FirstTeamPreview from './app/FirstTeamPreview'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('O11 application root was not found')
}

createRoot(root).render(
  <StrictMode>
    <FirstTeamPreview />
  </StrictMode>,
)
