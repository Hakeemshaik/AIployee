import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { STATUS, useApp } from '../lib/store.jsx';

/* ---------- icons: 24x24, stroke 1.8, round caps, currentColor ---------- */
const P = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  cal: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" />,
  friends: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.3A6.5 6.5 0 0 1 21.5 20" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: <><path d="M6 10a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  video: <><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></>,
  phone: <path d="M5 4h3.5l1.8 4.3-2.2 1.4a11 11 0 0 0 6.2 6.2l1.4-2.2L20 15.5V19a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  micOff: <><path d="M15 9.3V6a3 3 0 0 0-5.9-.8M9 9v2a3 3 0 0 0 4.9 2.3M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.2 5.3M12 17.5V21M3 3l18 18" /></>,
  camOff: <><path d="M15.5 10.5 21.5 7v10l-2.2-1.3M3 3l18 18M13 6h-.5M2.5 8v7a3 3 0 0 0 3 3h7a3 3 0 0 0 2.7-1.6" /></>,
  flip: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" /></>,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  pin: <><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  coffee: <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M12 3.5v2" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  block: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  status: <><circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 2.6" /><circle cx="12" cy="12" r="4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  tick: <path d="m4.5 12.5 4 4L19 6.5" />,
  ticks: <><path d="m2 12.5 4 4L16.5 6.5" /><path d="m11 16 .5.5L22 6.5" /></>,
  arrowIn: <path d="M17 7 7 17M7 9v8h8" />,
  arrowOut: <path d="M7 17 17 7M9 7h8v8" />,
  more: <><circle cx="12" cy="5.5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="18.5" r="1.2" /></>,
  userPlus: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></>,
};
export function Icon({ name, size = 22, className = '' }) {
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}

/* ---------- the Planner orb (iridescent glass) ---------- */
export function Orb({ size = 40, state = 'idle', className = '' }) {
  const sm = size <= 48 ? 'sm' : '';
  return <span className={`orb ${sm} ${state} ${className}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Avatar({ user, size = 40, showStatus = false }) {
  if (!user) return <Orb size={size} />;
  const initials = (user.display_name || user.username || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const st = STATUS[user.status] || STATUS.offline;
  return (
    <span className="avatar" style={{ width: size, height: size, '--hue': user.color, fontSize: size * 0.38 }}>
      {initials}
      {showStatus && <span className="avatar-dot" style={{ background: st.color }} />}
    </span>
  );
}

export function StatusPill({ status }) {
  const st = STATUS[status] || STATUS.offline;
  return <span className="pill" style={{ '--c': st.color }}><i />{st.label}</span>;
}

export function Sheet({ open, onClose, title, children }) {
  // Stay mounted for a moment after closing so the sheet can slide away.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className={`sheet-backdrop ${open ? '' : 'closing'}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-handle" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

/* ---------- bottom tab bar ---------- */
export function TabBar() {
  const { chatUnread } = useApp();
  const tabs = [
    ['/', 'chat', 'Chats', chatUnread],
    ['/calendar', 'cal', 'Calendar'],
    ['/calls', 'phone', 'Calls'],
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(([to, icon, label, badge]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <span className="tab-icon"><Icon name={icon} size={25} />{badge > 0 && <b className="badge">{badge > 99 ? '99+' : badge}</b>}</span>
          <span className="tab-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Toasts() {
  const { toasts, dismissToast, navigate } = useApp();
  const { pathname } = useLocation();
  return (
    <div className="toasts">
      {toasts.filter((t) => t.url !== pathname).map((t) => (
        <button key={t.tid} className="toast glass" onClick={() => { dismissToast(t.tid); t.url && navigate(t.url); }}>
          <strong>{t.title}</strong>
          {t.body && <span>{t.body}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Header({ title, sub, right, back, left }) {
  const { navigate } = useApp();
  return (
    <header className={`header ${back ? 'nav' : 'large'}`}>
      {back ? (
        <button className="back-btn" onClick={() => (window.history.length > 1 ? window.history.back() : navigate(back))} aria-label="Back">
          <Icon name="left" size={26} />
        </button>
      ) : left}
      <div className="grow">
        {title && <h1>{title}</h1>}
        {sub && <div className="subtitle">{sub}</div>}
      </div>
      <div className="header-right">{right}</div>
    </header>
  );
}

export const TYPE_LABEL = { hangout: 'Hangout', trip: 'Trip', call: 'Video call', meeting: 'Meeting', event: 'Event' };
export const reminderLabel = (m) => {
  m = Number(m) || 0;
  if (m >= 1440) return m === 1440 ? '1 day before' : `${Math.round(m / 1440)} days before`;
  if (m >= 60) return m === 60 ? '1 hour before' : `${+(m / 60).toFixed(1)} hours before`;
  return `${m} min before`;
};
