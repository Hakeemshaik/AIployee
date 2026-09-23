import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api.js';
import { useApp, useSocket, STATUS } from '../lib/store.jsx';
import { Avatar, Header, Sheet, Empty, Icon, Orb } from '../components/ui.jsx';
import { fmtTime, dayKey, addDays } from '../lib/dates.js';
import { shareInvite } from '../lib/share.js';

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (dayKey(d) === dayKey(new Date())) return fmtTime(d);
  if (dayKey(d) === dayKey(addDays(new Date(), -1))) return 'Yesterday';
  if (Date.now() - d < 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export default function Chats() {
  const { me, friends, navigate, toast, unread } = useApp();
  const [convs, setConvs] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [typing, setTyping] = useState({});
  const [newOpen, setNewOpen] = useState(false);
  const [group, setGroup] = useState(false);
  const [pick, setPick] = useState([]);
  const [name, setName] = useState('');
  const timers = useRef({});

  const load = () => get('/conversations').then((r) => setConvs(r.conversations)).catch(() => setConvs([]));
  useEffect(() => { load(); }, []);
  useSocket('message', load);
  useSocket('read', load);
  useSocket('conversations:changed', load);
  useSocket('presence', load);
  useSocket('typing', (p) => {
    setTyping((t) => ({ ...t, [p.conversation_id]: p.user }));
    clearTimeout(timers.current[p.conversation_id]);
    timers.current[p.conversation_id] = setTimeout(() => setTyping((t) => ({ ...t, [p.conversation_id]: null })), 3000);
  });

  const startDM = async (f) => {
    const r = await post('/conversations', { member_ids: [f.id] });
    setNewOpen(false); navigate(`/chat/${r.conversation.id}`);
  };
  const createGroup = async () => {
    try {
      const r = await post('/conversations', { member_ids: pick, name });
      setNewOpen(false); setGroup(false); setPick([]); setName('');
      navigate(`/chat/${r.conversation.id}`);
    } catch (e) { toast({ title: 'Could not create group', body: e.message }); }
  };

  const ai = convs?.find((c) => c.is_ai);
  let list = (convs || []).filter((c) => !c.is_ai);
  if (filter === 'unread') list = list.filter((c) => c.unread > 0);
  if (filter === 'groups') list = list.filter((c) => c.is_group);
  if (q.trim()) list = list.filter((c) => (c.title + ' ' + (c.last_message?.body || '')).toLowerCase().includes(q.trim().toLowerCase()));

  const preview = (c) => {
    const t = typing[c.id];
    if (t) return <span className="accent">{c.is_group ? `${t.display_name.split(' ')[0]} is typing…` : 'typing…'}</span>;
    const m = c.last_message;
    if (!m) return c.is_group ? 'Group created' : 'Say hi';
    const mine = m.sender_id === me?.id;
    const others = c.members.filter((u) => !u.me);
    const read = mine && others.length && others.every((u) => (c.reads?.[u.id] || '') >= m.created_at);
    const body = m.kind === 'plan' ? `Plan: ${m.body}` : m.body;
    return (
      <>
        {mine && <Icon name={read || others.some((u) => u.online) ? 'ticks' : 'tick'} size={16} className={`tick ${read ? 'read' : ''}`} />}
        {!mine && !!c.is_group && m.sender && <span>{m.sender.display_name.split(' ')[0]}: </span>}
        {!m.sender && m.kind === 'ai' && <span>Planner: </span>}
        <span>{body}</span>
      </>
    );
  };

  return (
    <>
      <Header
        left={<button className="me-btn plain" onClick={() => navigate('/settings')} aria-label="Settings"><Avatar user={me} size={34} />{unread > 0 && <b className="dot-badge" />}</button>}
        title="Chats"
        right={<button className="icon-plain accent" onClick={() => setNewOpen(true)} aria-label="New chat"><Icon name="edit" size={24} /></button>}
      />

      <label className="search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search chats" />
      </label>
      <div className="filters">
        {[['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups']].map(([k, l]) => (
          <button key={k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {friends.incoming.length > 0 && (
        <button className="row-item banner-row" onClick={() => navigate('/friends')}>
          <span className="round-ic" style={{ '--c': 'var(--accent)' }}><Icon name="userPlus" size={22} /></span>
          <span className="grow"><b>{friends.incoming.length} friend request{friends.incoming.length > 1 ? 's' : ''}</b><small>{friends.incoming.map((r) => r.user.display_name).join(', ')}</small></span>
          <Icon name="right" size={18} className="muted" />
        </button>
      )}

      <div className="chat-list">
        {ai && filter === 'all' && !q && (
          <button className="row-item enter" style={{ '--i': 0 }} onClick={() => navigate(`/chat/${ai.id}`)}>
            <Orb size={52} />
            <span className="grow">
              <span className="line1"><b>Planner</b><small className={ai.unread ? 'accent' : ''}>{when(ai.last_message?.created_at)}</small></span>
              <span className="line2"><span className="ellipsis">{ai.last_message?.kind === 'plan' ? `Plan: ${ai.last_message.body}` : ai.last_message?.body || 'Tell me what to plan'}</span>
                {ai.unread > 0 ? <b key={ai.unread} className="unread">{ai.unread}</b> : <Icon name="pin" size={16} className="muted" />}</span>
            </span>
          </button>
        )}
        {list.map((c, idx) => {
          const others = c.members.filter((m) => !m.me);
          return (
            <button key={c.id} className="row-item enter" style={{ '--i': idx + 1 }} onClick={() => navigate(`/chat/${c.id}`)}>
              {c.is_group
                ? <span className="stack">{others.slice(0, 2).map((m) => <Avatar key={m.id} user={m} size={36} />)}</span>
                : <Avatar user={others[0]} size={52} showStatus={others[0]?.online} />}
              <span className="grow">
                <span className="line1"><b className="ellipsis">{c.title}</b><small className={c.unread ? 'accent' : ''}>{when(c.last_message?.created_at)}</small></span>
                <span className="line2"><span className="ellipsis">{preview(c)}</span>{c.unread > 0 && <b key={c.unread} className="unread">{c.unread}</b>}</span>
              </span>
            </button>
          );
        })}
      </div>

      {convs && list.length === 0 && (filter !== 'all' || q) && <p className="muted center small mt">No chats match.</p>}
      {convs && list.length === 0 && filter === 'all' && !q && (
        <Empty title={friends.friends.length ? 'No chats yet' : 'Bring your friends'}
          action={friends.friends.length
            ? <button className="btn primary mt" onClick={() => setNewOpen(true)}>Start a chat</button>
            : <button className="btn primary mt" onClick={() => shareInvite(me, toast)}>Share invite link</button>}>
          {friends.friends.length ? 'Message a friend or start a group for a trip.' : 'Send your invite link. When they sign up with it, your chat opens right here.'}
        </Empty>
      )}

      <Sheet open={newOpen} onClose={() => { setNewOpen(false); setGroup(false); setPick([]); }} title={group ? 'New group' : 'New chat'}>
        {!group ? (
          <div className="sheet-list">
            <button className="row-item" onClick={() => setGroup(true)}>
              <span className="round-ic solid"><Icon name="friends" size={22} /></span><span className="grow"><b>New group</b></span>
            </button>
            <button className="row-item" onClick={() => { setNewOpen(false); shareInvite(me, toast); }}>
              <span className="round-ic solid"><Icon name="userPlus" size={22} /></span><span className="grow"><b>Invite a friend</b><small>Share a link, you're connected when they join</small></span>
            </button>
            <div className="list-label">Friends</div>
            {friends.friends.map((f) => (
              <button key={f.id} className="row-item" onClick={() => startDM(f)}>
                <Avatar user={f} size={44} showStatus={f.online} />
                <span className="grow"><b>{f.display_name}</b><small>{f.status_text || (f.online ? STATUS[f.status]?.label : 'Offline')}</small></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="form">
            <input placeholder="Group name, e.g. Durban trip" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="sheet-list">
              {friends.friends.map((f) => (
                <button key={f.id} className="row-item" onClick={() => setPick(pick.includes(f.id) ? pick.filter((x) => x !== f.id) : [...pick, f.id])}>
                  <Avatar user={f} size={44} />
                  <span className="grow"><b>{f.display_name}</b></span>
                  <span className={`check ${pick.includes(f.id) ? 'on' : ''}`}>{pick.includes(f.id) && <Icon name="check" size={16} />}</span>
                </button>
              ))}
            </div>
            <button className="btn primary block" disabled={pick.length < 1} onClick={createGroup}>Create group{pick.length ? ` (${pick.length + 1})` : ''}</button>
          </div>
        )}
      </Sheet>
    </>
  );
}
