import { useEffect, useState } from 'react';
import { get, post } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Header, Empty, Icon } from '../components/ui.jsx';
import { ago } from '../lib/dates.js';
import { enablePush, disablePush, pushState, isIOS, isStandalone } from '../lib/push.js';

const KIND_ICON = {
  event_invite: ['cal', 'var(--violet)'], event_update: ['cal', 'var(--blue)'], event_cancel: ['x', 'var(--danger)'], rsvp: ['check', 'var(--ok)'],
  reminder: ['clock', 'var(--gold)'], invite_call: ['video', 'var(--ok)'], invite_chill: ['coffee', 'var(--pink)'], invite_response: ['check', 'var(--ok)'],
  friend_request: ['userPlus', 'var(--violet)'], friend_accept: ['friends', 'var(--ok)'], message: ['chat', 'var(--blue)'], test: ['bell', 'var(--gold)'],
};

export default function Alerts() {
  const { config, setUnread, navigate, toast } = useApp();
  const [list, setList] = useState(null);
  const [ps, setPs] = useState(pushState());
  const [ai, setAi] = useState(null);

  const load = () => get('/notifications').then((r) => { setList(r.notifications); setUnread(r.unread); });
  useEffect(() => { load(); get('/ai/status').then(setAi).catch(() => {}); }, []);
  useSocket('notification', load);

  const readAll = async () => { await post('/notifications/read-all'); load(); };
  const open = async (n) => { if (!n.read) post(`/notifications/${n.id}/read`).then(load); navigate(n.url); };

  const turnOn = async () => {
    try { await enablePush(config.vapidPublicKey); setPs(pushState()); toast({ title: 'Notifications on' }); }
    catch (e) { toast({ title: 'Could not enable', body: e.message, ms: 8000 }); setPs(pushState()); }
  };
  const test = async () => {
    const r = await post('/push/test');
    toast({ title: r.total ? `Test sent to ${r.sent}/${r.total} device(s)` : 'No devices subscribed yet', body: r.total ? 'Lock your phone or switch apps to see it' : 'Turn notifications on first' });
  };

  return (
    <>
      <Header back="/" title="Alerts" right={list?.some((n) => !n.read) && <button className="link" onClick={readAll}>Mark all read</button>} />

      <section className="group-list panel">
        <b>Push notifications</b>
        {ps === 'granted' && <p className="small">On for this device. You'll get messages, invites, calls and reminders with the full details.</p>}
        {ps === 'default' && <p className="small">Get notified about invites, calls, plan changes and reminders.</p>}
        {ps === 'denied' && <p className="small error">Blocked. Enable notifications for this site in your browser or phone settings, then reload.</p>}
        {ps === 'needs-install' && (
          <ol className="small steps">
            <li>Tap the <b>Share</b> button in Safari</li>
            <li>Choose <b>Add to Home Screen</b></li>
            <li>Open Linkup from your home screen and come back here</li>
          </ol>
        )}
        {ps === 'unsupported' && <p className="small">This browser doesn't support push. Use Chrome on Android, or Safari on iPhone (iOS 16.4+) added to the home screen.</p>}
        <div className="row gap mt">
          {ps === 'default' && <button className="btn primary grow" onClick={turnOn}>Turn on</button>}
          {ps === 'granted' && <button className="btn grow" onClick={test}>Send test</button>}
          {ps === 'granted' && <button className="btn grow" onClick={async () => { await disablePush(); toast({ title: 'Push off for this device' }); }}>Turn off</button>}
        </div>
        {isIOS() && isStandalone() && ps === 'granted' && <p className="muted small mt">iPhone tip: Settings → Notifications → Linkup → allow Lock Screen & Banners.</p>}
      </section>

      <h2 className="list-label">Recent</h2>
      {!list ? <div className="spinner" /> : list.length === 0 ? <Empty title="All caught up">Invites, replies and reminders show up here.</Empty> : <div className="group-list">{list.map((n) => (
        <button key={n.id} className={`row-item notif ${n.read ? '' : 'unread'}`} onClick={() => open(n)}>
          <span className="qi" style={{ '--c': (KIND_ICON[n.kind] || KIND_ICON.test)[1] }}><Icon name={(KIND_ICON[n.kind] || KIND_ICON.test)[0]} /></span>
          <span className="grow"><b>{n.title}</b><small className="wrap">{n.body}</small></span>
          <small className="mono muted">{ago(n.created_at)}</small>
        </button>
      ))}</div>}

      <p className="muted small center mt">Planner: {ai ? `${ai.model}, ${ai.online ? 'online' : 'offline'}` : '…'}</p>
    </>
  );
}
