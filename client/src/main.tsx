import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Play from './screens/Play.tsx'
import Leaderboard from './screens/Leaderboard.tsx'
import AdminApp from './screens/admin/AdminApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Play />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        {/* Deliberately unlinked from the player UI. */}
        <Route path="/admin" element={<AdminApp />} />
        <Route path="*" element={<Play />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
