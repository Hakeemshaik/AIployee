import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconFoods,
  IconPlan,
  IconSettings,
  IconToday,
  IconTrends,
} from './components/Icons'
import { FoodsScreen } from './screens/FoodsScreen'
import { PlanScreen } from './screens/PlanScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TodayScreen } from './screens/TodayScreen'
import { TrendsScreen } from './screens/TrendsScreen'
import { useStore } from './state/store'

type Tab = 'today' | 'plan' | 'foods' | 'trends' | 'settings'

const TABS: { key: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { key: 'today', label: 'Today', Icon: IconToday },
  { key: 'plan', label: 'Plan', Icon: IconPlan },
  { key: 'foods', label: 'Foods', Icon: IconFoods },
  { key: 'trends', label: 'Trends', Icon: IconTrends },
  { key: 'settings', label: 'Settings', Icon: IconSettings },
]

const isTab = (v: string): v is Tab => TABS.some((t) => t.key === v)

export default function App() {
  const { data } = useStore()
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.replace('#/', '')
    return isTab(hash) ? hash : 'today'
  })
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number>()

  // Hash routing keeps the phone's back button working between tabs.
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace('#/', '')
      if (isTab(hash)) setTab(hash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (window.location.hash !== `#/${tab}`) window.location.hash = `#/${tab}`
    window.scrollTo({ top: 0 })
  }, [tab])

  // Theme: an explicit choice wins, otherwise follow the OS.
  useEffect(() => {
    const pref = data.settings.theme
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const light = pref === 'light' || (pref === 'system' && mq.matches)
      document.documentElement.dataset.theme = light ? 'light' : 'dark'
      document
        .querySelector('meta[name="theme-color"]:not([media])')
        ?.setAttribute('content', light ? '#f6f7f5' : '#0b0f0d')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [data.settings.theme])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2200)
  }, [])

  return (
    <div className={`app${tab === 'today' ? ' has-fab' : ''}`}>
      {tab === 'today' && <TodayScreen toast={toast} />}
      {tab === 'plan' && <PlanScreen toast={toast} />}
      {tab === 'foods' && <FoodsScreen toast={toast} />}
      {tab === 'trends' && <TrendsScreen toast={toast} />}
      {tab === 'settings' && <SettingsScreen toast={toast} />}

      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}

      <nav className="tabbar">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
