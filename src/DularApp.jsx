import { useEffect, useState } from 'react'
import MilestoneOneApp from './MilestoneOneApp.jsx'
import SelfCustodyApp from './SelfCustodyApp.jsx'
import './App.css'

const MODE_KEY = 'dular_mode'

function readMode() {
  return localStorage.getItem(MODE_KEY) || 'self_custody'
}

export default function DularApp() {
  const [mode, setMode] = useState(null)

  useEffect(() => {
    setMode(readMode())
  }, [])

  function selectMode(nextMode) {
    localStorage.setItem(MODE_KEY, nextMode)
    setMode(nextMode)
  }

  if (!mode) return null
  if (mode === 'managed') return <MilestoneOneApp />
  return <SelfCustodyApp />
}
