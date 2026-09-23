import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { AppProvider, useApp } from './lib/store.jsx';
import { TabBar, Toasts, Orb } from './components/ui.jsx';
import { post } from './lib/api.js';
import IncomingInvite from './components/IncomingInvite.jsx';
import Login from './pages/Login.jsx';
import Chats from './pages/Chats.jsx';
import ChatRoom from './pages/ChatRoom.jsx';
import Calendar from './pages/Calendar.jsx';
import Calls from './pages/Calls.jsx';
import Settings from './pages/Settings.jsx';
import Friends from './pages/Friends.jsx';
import Plans from './pages/Plans.jsx';
import EventForm from './pages/EventForm.jsx';
import EventPage from './pages/EventPage.jsx';
import Alerts from './pages/Alerts.jsx';
import Call from './pages/Call.jsx';
import InvitePage from './pages/InvitePage.jsx';
import './styles.css';

const TAB_ROOTS = ['/', '/calendar', '/calls'];

/* First-open splash: the orb blooms in, the name settles, then the app. Once per session. */
function Splash() {
  const [show, setShow] = useState(() => { try { return !sessionStorage.getItem('linkup_splash'); } catch { return true; } });
  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem('linkup_splash', '1'); } catch { /* ignore */ }
    const t = setTimeout(() => setShow(false), 1300);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return <div className="splash" aria-hidden="true"><Orb size={96} state="speaking" /><b>Linkup</b></div>;
}

/* Signed in with a friend's invite link: connect and jump into the new chat. */
function useInviteAccept(token, navigate, toast) {
  const done = useRef(false);
  useEffect(() => {
    if (!token || done.current) return;
    let inv = (location.pathname.match(/^\/join\/([^/]+)/) || [])[1];
    try { inv = inv || sessionStorage.getItem('linkup_invite'); } catch { /* ignore */ }
    if (!inv) return;
    done.current = true;
    post('/invite-link/accept', { token: inv })
      .then((r) => { toast({ title: `You and ${r.friend.display_name} are connected`, body: 'Say hi!' }); navigate(`/chat/${r.conversation_id}`, { replace: true }); })
      .catch((e) => { toast({ title: 'Invite link', body: e.message }); if (location.pathname.startsWith('/join/')) navigate('/', { replace: true }); })
      .finally(() => { try { sessionStorage.removeItem('linkup_invite'); } catch { /* ignore */ } });
  }, [token]); // eslint-disable-line
}

const depth = (p) => (TAB_ROOTS.includes(p) ? 0 : p.split('/').filter(Boolean).length);

function Shell() {
  const { token, navigate, toast } = useApp();
  const loc = useLocation();
  const navType = useNavigationType();
  const prev = useRef(loc.pathname);
  useInviteAccept(token, navigate, toast);

  // Screen transition: tabs crossfade, going deeper slides in, going back slides the other way.
  let anim = 'fade';
  if (prev.current !== loc.pathname) {
    const a = depth(prev.current), b = depth(loc.pathname);
    anim = b === 0 && a === 0 ? 'fade' : navType === 'POP' || b < a ? 'slide-back' : 'slide-in';
  }
  useEffect(() => { prev.current = loc.pathname; }, [loc.pathname]);

  if (!token) return <><Splash /><Login /></>;
  const fullScreen = loc.pathname.startsWith('/call/') || /^\/chat\/.+/.test(loc.pathname);
  const showTabs = TAB_ROOTS.includes(loc.pathname);
  return (
    <div className={`app ${fullScreen ? 'fullscreen' : ''} ${showTabs ? 'with-tabs' : ''}`}>
      <Splash />
      <main className={`page ${anim}`} key={loc.pathname}>
        <Routes>
          <Route path="/" element={<Chats />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/chat/:id" element={<ChatRoom />} />
          <Route path="/status" element={<Navigate to="/settings" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/new" element={<EventForm />} />
          <Route path="/event/:id" element={<EventPage />} />
          <Route path="/event/:id/edit" element={<EventForm />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/call/:room" element={<Call />} />
          <Route path="/invite/:id" element={<InvitePage />} />
          <Route path="/join/:token" element={<div className="spinner" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {showTabs && <TabBar />}
      <Toasts />
      <IncomingInvite />
    </div>
  );
}

function Root() {
  const navigate = useNavigate();
  return (
    <AppProvider navigate={navigate}>
      <Shell />
    </AppProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>
);
