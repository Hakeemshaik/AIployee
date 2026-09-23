import { useEffect, useState } from 'react';
import { patch } from '../lib/api.js';
import { useApp, STATUS } from '../lib/store.jsx';
import { Avatar, Header, Icon, Sheet } from '../components/ui.jsx';
import { disablePush } from '../lib/push.js';

export default function Settings() {
  const { me, setMe, friends, navigate, unread, logout, toast } = useApp();
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(me?.display_name || '');
  const [statusOpen, setStatusOpen] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => { setText(me?.status_text || ''); }, [me?.status_text]);
  const st = STATUS[me?.status] || STATUS.available;
  const setStatus = async (status) => { const r = await patch('/me', { status }); setMe({ ...me, ...r.user }); };
  const saveStatus = async () => { const r = await patch('/me', { status_text: text }); setMe({ ...me, ...r.user }); setStatusOpen(false); };

  const saveName = async () => {
    try { const r = await patch('/me', { display_name: name }); setMe({ ...me, ...r.user }); setEditName(false); }
    catch (e) { toast({ title: 'Could not save', body: e.message }); }
  };

  const Row = ({ icon, color, title, sub, badge, onClick }) => (
    <button className="row-item" onClick={onClick}>
      <span className="round-ic solid sq" style={{ '--c': color }}><Icon name={icon} size={20} /></span>
      <span className="grow"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {badge > 0 && <b className="unread">{badge}</b>}
      <Icon name="right" size={18} className="muted" />
    </button>
  );

  return (
    <>
      <Header back="/" title="Settings" />
      <div className="group-list">
        <button className="row-item profile" onClick={() => setEditName(true)}>
          <Avatar user={me} size={64} />
          <span className="grow">
            <b className="big">{me?.display_name}</b>
            <small><span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>{me?.status_text && ` · ${me.status_text}`}</small>
            <small className="mono">@{me?.username}</small>
          </span>
          <Icon name="edit" size={20} className="muted" />
        </button>
      </div>

      <div className="group-list">
        <Row icon="friends" color="#4DA3FF" title="Friends" sub={`${friends.friends.length} friends`} badge={friends.incoming.length} onClick={() => navigate('/friends')} />
        <Row icon="list" color="#8B6CFF" title="All plans" sub="Everything you're invited to" onClick={() => navigate('/plans')} />
        <Row icon="bell" color="#FF8A3D" title="Notifications" sub="Turn on, test, see recent alerts" badge={unread} onClick={() => navigate('/alerts')} />
        <Row icon="status" color="#3CC47C" title="My status" sub={`${st.label}${me?.status_text ? ` · ${me.status_text}` : ''}`} onClick={() => setStatusOpen(true)} />
      </div>

      <div className="group-list">
        <button className="row-item" onClick={async () => { await disablePush().catch(() => {}); logout(); }}>
          <span className="grow"><b className="danger">Sign out</b></span>
        </button>
      </div>

      <Sheet open={statusOpen} onClose={() => setStatusOpen(false)} title="My status">
        <div className="form">
          <div className="group-list">
            {[['available', 'Friends can call or invite you'], ['busy', 'Invites still arrive, quietly'], ['work', 'Shown as at work'], ['away', 'Back later'], ['invisible', 'Look offline to everyone']].map(([k, hint]) => (
              <button key={k} className="row-item" onClick={() => setStatus(k)}>
                <i className="dot-lg" style={{ background: STATUS[k].color }} />
                <span className="grow"><b>{STATUS[k].label}</b><small>{hint}</small></span>
                {me?.status === k && <Icon name="check" size={20} className="accent" />}
              </button>
            ))}
          </div>
          <label>What are you up to?
            <input placeholder="e.g. at the gym till 6" value={text} maxLength={80} onChange={(e) => setText(e.target.value)} />
          </label>
          <button className="btn primary block" onClick={saveStatus}>Done</button>
        </div>
      </Sheet>

      <Sheet open={editName} onClose={() => setEditName(false)} title="Your name">
        <div className="form">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <p className="muted small">This is what friends see. Your username stays <b className="mono">@{me?.username}</b>.</p>
          <button className="btn primary block" onClick={saveName} disabled={!name.trim()}>Save</button>
        </div>
      </Sheet>
    </>
  );
}
