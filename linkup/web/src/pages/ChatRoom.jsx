import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useApp, useSocket, STATUS } from '../lib/store.jsx';
import { Avatar, Orb, Icon, Sheet, TYPE_LABEL, reminderLabel } from '../components/ui.jsx';
import { fmtRange, fmtTime, relDay, dayKey, ago } from '../lib/dates.js';

/* Planner's plan suggestion, rendered as a notice card. */
function PlanCard({ msg, members, onDone }) {
  const { toast, me } = useApp();
  const p = msg.data?.plan || {};
  const created = msg.data?.status === 'created';
  const [edit, setEdit] = useState(!p.date && !created);
  const [f, setF] = useState({
    title: p.title || '', date: p.date || '', end_date: p.end_date || '', start_time: p.start_time || '18:00',
    end_time: p.end_time || '21:00', location: p.location || '', notes: p.notes || '', participant_ids: p.participant_ids || [],
    reminder_minutes: p.reminder_minutes || 60,
  });
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const name = (id) => (id === me?.id ? 'You' : members.find((m) => m.id === id)?.display_name.split(' ')[0]);

  const confirm = async () => {
    setBusy(true);
    try {
      const body = edit ? { ...f, end_date: f.end_date || null, reminder_minutes: +f.reminder_minutes } : {};
      await post(`/messages/${msg.id}/confirm-plan`, body);
      setBurst(true); setTimeout(() => setBurst(false), 1400);
      navigator.vibrate?.(30);
      toast({ title: 'Booked. Invites sent', body: `Everyone gets a reminder ${reminderLabel(edit ? f.reminder_minutes : p.reminder_minutes)}` });
    } catch (e) { toast({ title: 'Could not book it', body: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className={`notice ${created ? 'done' : ''} ${burst ? 'celebrate' : ''}`}>
      {burst && <span className="burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${i * (360 / 14)}deg`, '--d': `${40 + (i % 3) * 18}px` }} />)}</span>}
      <div className="notice-strip"><Icon name={created ? 'check' : 'cal'} size={15} className={created ? 'draw' : ''} />{created ? 'Booked' : 'Plan ready'}<span>{TYPE_LABEL[p.type] || 'Plan'}</span></div>
      <div className="notice-body">
      {!edit ? (
        <>
          <div className="notice-title">{p.title}</div>
          <div className="notice-row"><Icon name="cal" size={16} />{p.start_at ? fmtRange(p.start_at, p.end_at) : 'No date yet'}</div>
          {p.location && <div className="notice-row"><Icon name="pin" size={16} />{p.location}</div>}
          <div className="notice-row"><Icon name="friends" size={16} />{(p.participant_ids || []).map(name).filter(Boolean).join(', ')}</div>
          <div className="notice-row reward"><Icon name="bell" size={16} /><span className="mono">{reminderLabel(p.reminder_minutes || 60)}</span></div>
          {p.notes && <div className="notice-notes">{p.notes}</div>}
          {p.conflicts?.length > 0 && !created && (
            <div className="conflict">{p.conflicts.map((c) => `${name(c.user_id) || c.name}: ${c.detail}`).join(' · ')}</div>
          )}
        </>
      ) : (
        <div className="form tight">
          <input value={f.title} onChange={set('title')} placeholder="What" aria-label="What" />
          <div className="grid2">
            <input type="date" value={f.date} min={dayKey(new Date())} onChange={set('date')} aria-label="Date" />
            <select value={f.reminder_minutes} onChange={set('reminder_minutes')} aria-label="Reminder">
              {[15, 30, 60, 120, 1440].map((v) => <option key={v} value={v}>{reminderLabel(v)}</option>)}
            </select>
            <input type="time" value={f.start_time} onChange={set('start_time')} aria-label="Starts" />
            <input type="time" value={f.end_time} onChange={set('end_time')} aria-label="Ends" />
          </div>
          <input value={f.location} onChange={set('location')} placeholder="Where (optional)" aria-label="Where" />
          <div className="pick">
            {members.map((m) => (
              <button key={m.id} type="button" className={`pick-item ${f.participant_ids.includes(m.id) ? 'on' : ''}`}
                onClick={() => setF({ ...f, participant_ids: f.participant_ids.includes(m.id) ? f.participant_ids.filter((x) => x !== m.id) : [...f.participant_ids, m.id] })}>
                <Avatar user={m} size={30} /><span>{m.id === me?.id ? 'You' : m.display_name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {created ? (
        <button className="btn block" onClick={() => onDone?.(msg.data.event_id)}>View plan</button>
      ) : (
        <div className="row gap mt">
          <button className="btn grow" onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Change'}</button>
          <button className="btn primary grow" disabled={busy || (edit && !f.date)} onClick={confirm}>{busy ? 'Booking…' : 'Book it'}</button>
        </div>
      )}
      </div>
    </div>
  );
}

/* Reveals Planner's words one by one, only for messages that just arrived. */
function Reveal({ text, fresh }) {
  const words = text.split(/(\s+)/);
  const [n, setN] = useState(fresh ? 0 : words.length);
  useEffect(() => {
    if (!fresh || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(words.length); return; }
    const t = setInterval(() => setN((x) => (x >= words.length ? (clearInterval(t), x) : x + 2)), 45);
    return () => clearInterval(t);
  }, []); // eslint-disable-line
  return <>{words.slice(0, n).join('')}</>;
}

function lastSeen(u) {
  if (!u) return '';
  if (u.online) return u.status === 'available' ? 'online' : `online · ${({ busy: 'busy', work: 'at work', away: 'away' })[u.status] || ''}`;
  if (!u.last_seen) return 'offline';
  const d = new Date(u.last_seen);
  const day = dayKey(d) === dayKey(new Date()) ? 'today' : relDay(d).toLowerCase();
  return `last seen ${day} at ${fmtTime(d)}`;
}

export function ChatView({ convId: id }) {
  const { me, friends, navigate, toast, loadUnread, socket } = useApp();
  const [qs, setQs] = useSearchParams();
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState(qs.get('draft') || '');
  const [thinking, setThinking] = useState(false);
  const [typing, setTyping] = useState(null);
  const [attach, setAttach] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const lastTyping = useRef(0);
  const typingTimer = useRef(null);
  const freshIds = useRef(new Set());
  const initialIds = useRef(null);

  const markRead = () => post(`/conversations/${id}/read`).then(loadUnread).catch(() => {});

  useEffect(() => {
    setMsgs([]); setConv(null);
    get(`/conversations/${id}`).then((r) => setConv(r.conversation)).catch(() => navigate('/', { replace: true }));
    get(`/conversations/${id}/messages`).then((r) => { initialIds.current = new Set(r.messages.map((m) => m.id)); setMsgs(r.messages); });
    markRead();
    if (qs.get('draft')) { setText(qs.get('draft')); setQs({}, { replace: true }); setTimeout(() => inputRef.current?.focus(), 300); }
  }, [id]); // eslint-disable-line

  useLayoutEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, thinking, typing]);

  useSocket('message', (m) => {
    if (m.conversation_id !== id) return;
    if (!m.sender_id) freshIds.current.add(m.id);
    setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]));
    if (m.sender_id !== me?.id) markRead();
    setTyping(null);
  });
  useSocket('message:update', (m) => m.conversation_id === id && setMsgs((x) => x.map((y) => (y.id === m.id ? m : y))));
  useSocket('ai:thinking', (p) => p.conversation_id === id && setThinking(p.on));
  useSocket('read', (p) => p.conversation_id === id && setConv((c) => c && { ...c, reads: { ...c.reads, [p.user_id]: p.at } }));
  useSocket('typing', (p) => {
    if (p.conversation_id !== id) return;
    setTyping(p.user);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(null), 3000);
  });
  useSocket('presence', (p) => setConv((c) => c && { ...c, members: c.members.map((m) => (m.id === p.id && !m.me ? p : m)) }));

  const onType = (e) => {
    setText(e.target.value);
    if (Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); socket?.emit('typing', { conversation_id: id }); }
  };

  const sendText = async (body) => {
    body = body.trim();
    if (!body) return;
    setText('');
    try {
      const r = await post(`/conversations/${id}/messages`, { body });
      setMsgs((x) => (x.some((y) => y.id === r.message.id) ? x : [...x, r.message]));
    } catch (x) { toast({ title: 'Not sent', body: x.message }); setText(body); }
  };
  const send = (e) => { e?.preventDefault(); sendText(text); inputRef.current?.focus(); };

  const planIt = async () => {
    setAttach(false);
    try { await post(`/conversations/${id}/plan`); } catch (x) { toast({ title: 'Planner', body: x.message }); }
  };
  const callAll = async () => {
    const ids = conv.members.filter((m) => !m.me).map((m) => m.id);
    try { const r = await post('/invites', { to_ids: ids, kind: 'call' }); navigate(`/call/${r.room_id}`); }
    catch (x) { toast({ title: 'Could not call', body: x.message }); }
  };
  const chill = async () => {
    setAttach(false);
    const ids = conv.members.filter((m) => !m.me).map((m) => m.id);
    try { await post('/invites', { to_ids: ids, kind: 'chill', message: text.trim() }); setText(''); toast({ title: 'Chill invite sent' }); }
    catch (x) { toast({ title: 'Could not send', body: x.message }); }
  };
  const openEvent = (eid) => navigate(`/event/${eid}`);

  if (!conv) return <div className="chat"><div className="spinner" /></div>;
  const planner = !!conv.is_ai;
  const others = conv.members.filter((m) => !m.me);
  const planMembers = planner ? [me, ...friends.friends].filter(Boolean) : conv.members;
  const sub = planner ? (thinking ? 'thinking…' : 'finds times, books plans, reminds everyone')
    : typing ? `${conv.is_group ? `${typing.display_name.split(' ')[0]} is ` : ''}typing…`
    : conv.is_group ? others.map((m) => m.display_name.split(' ')[0]).join(', ') + ', You'
    : lastSeen(others[0]);

  const tickFor = (m) => {
    const readAll = others.length && others.every((u) => (conv.reads?.[u.id] || '') >= m.created_at);
    if (readAll) return <Icon name="ticks" size={16} className="tick read" />;
    if (others.some((u) => u.online)) return <Icon name="ticks" size={16} className="tick" />;
    return <Icon name="tick" size={16} className="tick" />;
  };

  const userMsgs = msgs.filter((m) => m.sender_id).length;
  const f1 = friends.friends[0]?.display_name.split(' ')[0];
  const starters = planner && userMsgs === 0 ? [
    f1 ? `Padel with ${f1} this weekend` : 'Braai this Saturday',
    'When is everyone free next week?',
    'Remind me to book flights Monday 9am',
  ] : [];
  const lastAi = [...msgs].reverse().find((m) => !m.sender_id && m.kind !== 'system');
  const quick = planner && lastAi?.kind === 'plan' && lastAi.data?.status !== 'created'
    ? ['Make it earlier', 'Invite everyone', 'Remind me a day before'] : [];
  const nameColor = (u) => u?.color || 'var(--accent)';

  let lastDay = '';
  let prevSender = null;
  return (
    <div className="chat">
      <header className="chat-header">
        <button className="back-btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="left" size={26} /></button>
        <button className="chat-who plain" onClick={() => !planner && !conv.is_group && others[0] && navigate('/friends')}>
          {planner ? <Orb size={38} state={thinking ? 'thinking' : 'idle'} /> : conv.is_group
            ? <span className="stack sm">{others.slice(0, 2).map((m) => <Avatar key={m.id} user={m} size={28} />)}</span>
            : <Avatar user={others[0]} size={38} />}
          <span className="grow">
            <b className="ellipsis">{planner ? 'Planner' : conv.title}</b>
            <small className={`ellipsis ${typing || (thinking && planner) ? 'accent' : ''}`}>{sub}</small>
          </span>
        </button>
        {!planner && <>
          <button className="icon-plain" onClick={callAll} aria-label="Video call"><Icon name="video" size={24} /></button>
          <button className="icon-plain" onClick={callAll} aria-label="Call"><Icon name="phone" size={22} /></button>
        </>}
      </header>

      <div className="messages wallpaper">
        {planner && <div className="info-pill">Tell Planner what you want to do and who with. It picks a time you're all free, books it and reminds everyone.</div>}
        {msgs.map((m) => {
          const day = dayKey(m.created_at);
          const sep = day !== lastDay ? (lastDay = day, prevSender = null, <div className="day-sep" key={`d${day}`}><span>{relDay(m.created_at)}</span></div>) : null;
          const mine = m.sender_id === me?.id;
          const senderKey = m.sender_id || 'ai';
          const first = senderKey !== prevSender;
          prevSender = m.kind === 'system' ? null : senderKey;
          if (m.kind === 'system') return [sep, <div key={m.id} className="sys"><span>{m.body}</span></div>];
          if (m.kind === 'plan') return [sep, <div key={m.id} className={`row-msg in ${first ? 'first' : ''} ${initialIds.current && !initialIds.current.has(m.id) ? 'pop' : ''}`}><PlanCard msg={m} members={planMembers} onDone={openEvent} /></div>];
          const ai = m.kind === 'ai';
          const isNew = initialIds.current && !initialIds.current.has(m.id);
          return [sep, (
            <div key={m.id} className={`row-msg ${mine ? 'out' : 'in'} ${first ? 'first' : ''} ${isNew ? 'pop' : ''}`}>
              <div className={`bubble ${ai && !planner ? 'ai' : ''}`}>
                {first && !mine && (conv.is_group || (ai && !planner)) && (
                  <span className="who" style={{ color: ai ? 'var(--accent)' : nameColor(m.sender) }}>{ai ? 'Planner' : m.sender?.display_name}</span>
                )}
                <span className="text">{ai ? <Reveal text={m.body} fresh={freshIds.current.has(m.id)} /> : m.body}</span>
                <span className="meta">{fmtTime(m.created_at)}{mine && tickFor(m)}</span>
              </div>
            </div>
          )];
        })}
        {(thinking || typing) && (
          <div className="row-msg in first"><div className="bubble typing-bubble"><span /><span /><span /></div></div>
        )}
        <div ref={endRef} />
      </div>

      {(starters.length > 0 || quick.length > 0) && !thinking && (
        <div className="suggest-row">{[...starters, ...quick].map((q) => <button key={q} className="suggest-chip" onClick={() => sendText(q)}>{q}</button>)}</div>
      )}

      <form className="composer" onSubmit={send}>
        {!planner && <button type="button" className="icon-plain" onClick={() => setAttach(true)} aria-label="More"><Icon name="plus" size={26} /></button>}
        <div className="input-pill">
          <input ref={inputRef} value={text} onChange={onType} enterKeyHint="send"
            placeholder={planner ? 'What should we plan?' : 'Message'} aria-label="Message" />
          {!planner && <button type="button" className="icon-plain sm" onClick={planIt} disabled={thinking} aria-label="Plan it with Planner"><Orb size={24} state={thinking ? 'thinking' : 'idle'} /></button>}
        </div>
        <button className={`send ${text.trim() ? 'ready' : ''}`} disabled={!text.trim()} aria-label="Send"><Icon name="send" size={20} /></button>
      </form>

      <Sheet open={attach} onClose={() => setAttach(false)}>
        <div className="attach-grid">
          <button onClick={planIt}><span className="ai-tile"><Orb size={30} /></span>Plan it</button>
          <button onClick={() => { setAttach(false); navigate(`/plans/new?with=${others.map((o) => o.id).join(',')}`); }}><span style={{ '--c': 'var(--violet)' }}><Icon name="cal" size={26} /></span>New plan</button>
          <button onClick={() => { setAttach(false); callAll(); }}><span style={{ '--c': 'var(--ok)' }}><Icon name="video" size={26} /></span>Video call</button>
          <button onClick={chill}><span style={{ '--c': 'var(--pink)' }}><Icon name="coffee" size={26} /></span>Chill invite</button>
        </div>
        <p className="muted small center">Tip: type @ai in a message to ask Planner right here.</p>
      </Sheet>
    </div>
  );
}

export default function ChatRoom() {
  const { id } = useParams();
  return <ChatView key={id} convId={id} />;
}
