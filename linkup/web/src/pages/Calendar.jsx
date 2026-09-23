import { useEffect, useMemo, useState } from 'react';
import { get, post, del } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Sheet, Icon, Orb, TYPE_LABEL } from '../components/ui.jsx';
import { addDays, dayKey, fromKey, fmtLongDay, fmtTime } from '../lib/dates.js';

const STATE = {
  free: { label: 'Free', color: 'var(--ok)' },
  partial: { label: 'Some plans', color: 'var(--gold)' },
  busy: { label: 'Busy', color: 'var(--danger)' },
  work: { label: 'At work', color: 'var(--blue)' },
};
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dayState(uid, key, data) {
  const blocks = data.blocks.filter((b) => b.user_id === uid && b.date === key);
  const allDay = blocks.find((b) => !b.start_time);
  const start = fromKey(key, '00:00').getTime();
  const end = start + 86400000;
  const evs = data.events.filter((e) => e.user_id === uid && Date.parse(e.start_at) < end && Date.parse(e.end_at) > start);
  if (allDay && allDay.kind !== 'free') return { state: allDay.kind, blocks, evs };
  if (evs.some((e) => Date.parse(e.start_at) <= start + 8 * 3600000 && Date.parse(e.end_at) >= end - 2 * 3600000)) return { state: 'busy', blocks, evs };
  if (evs.length || blocks.some((b) => b.start_time && b.kind !== 'free')) return { state: 'partial', blocks, evs };
  return { state: 'free', blocks, evs };
}

export default function Calendar() {
  const { me, navigate, toast, openPlanner } = useApp();
  const today = dayKey(new Date());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(today);
  const [data, setData] = useState({ users: [], blocks: [], events: [] });
  const [blockOpen, setBlockOpen] = useState(false);
  const [block, setBlock] = useState({ kind: 'busy', start_time: '09:00', end_time: '17:00', note: '' });

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(first, -offset);
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => addDays(start, i));
  }, [cursor]);
  const from = dayKey(grid[0]);
  const to = dayKey(grid[grid.length - 1]);

  const load = () => get(`/availability?from=${from}&to=${to}`).then(setData).catch(() => {});
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line
  useSocket('availability:changed', load);
  useSocket('events:changed', load);

  const users = [...data.users].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
  const myEvents = (key) => {
    const s = fromKey(key, '00:00').getTime(); const e = s + 86400000;
    const seen = new Set();
    return data.events
      .filter((ev) => ev.visible && ev.user_id === me?.id && Date.parse(ev.start_at) < e && Date.parse(ev.end_at) > s)
      .filter((ev) => (seen.has(ev.id) ? false : seen.add(ev.id)))
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  };

  const selDate = fromKey(sel);
  const selRows = users.map((u) => ({ u, ...dayState(u.id, sel, data) }));
  const selEvents = myEvents(sel);
  const myBlocks = data.blocks.filter((b) => b.user_id === me?.id && b.date === sel);
  const myAllDay = myBlocks.find((b) => !b.start_time)?.kind || 'free';
  const freeFriends = selRows.filter((r) => !r.u.me && r.state === 'free').length;

  const setDay = async (kind) => {
    if (kind === 'free') await del(`/availability?date=${sel}`);
    else await post('/availability', { date: sel, kind });
    load();
  };
  const addBlock = async () => {
    try { await post('/availability', { date: sel, ...block }); setBlockOpen(false); load(); }
    catch (e) { toast({ title: 'Could not save', body: e.message }); }
  };
  const month = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const dayWord = sel === today ? 'today' : selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <>
      <header className="header large">
        <div className="grow"><h1>Calendar</h1></div>
        <button className="icon-plain accent" onClick={() => navigate('/plans/new')} aria-label="New plan"><Icon name="plus" size={26} /></button>
      </header>
      <div className="month-nav">
        <b>{cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <button className="icon-plain accent" onClick={() => month(-1)} aria-label="Previous month"><Icon name="left" /></button>
        <button className="icon-plain accent" onClick={() => month(1)} aria-label="Next month"><Icon name="right" /></button>
      </div>

      <section className="month">
        <div className="cal-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="cal-grid">
          {grid.map((d) => {
            const key = dayKey(d);
            const evs = myEvents(key);
            const mineBusy = data.blocks.some((b) => b.user_id === me?.id && b.date === key && b.kind !== 'free');
            const allFree = users.length > 1 && key >= today && users.every((u) => dayState(u.id, key, data).state === 'free');
            const cls = ['cal-day', d.getMonth() !== cursor.getMonth() && 'out', key < today && 'past', key === today && 'today', key === sel && 'sel'].filter(Boolean).join(' ');
            return (
              <button key={key} className={cls} onClick={() => setSel(key)}
                aria-label={`${fmtLongDay(d)}${evs.length ? `, ${evs.length} plans` : ''}${allFree ? ', everyone free' : ''}`}>
                <span className="n mono">{d.getDate()}</span>
                <span className="dots">
                  {evs.slice(0, 3).map((e) => <i key={e.id} className={`dot t-${e.type}`} />)}
                  {!evs.length && mineBusy && <i className="dot mine-busy" />}
                  {!evs.length && !mineBusy && allFree && <i className="dot all-free" />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="legend">
          <span><i className="dot t-hangout" />Your plans</span>
          <span><i className="dot mine-busy" />You're busy</span>
          <span><i className="dot all-free" />Everyone's free</span>
          {(cursor.getMonth() !== new Date().getMonth() || sel !== today) && (
            <button className="link" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(today); }}>Today</button>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="list-label">{sel === today ? 'Today' : fmtLongDay(selDate)}</h2>
          <button className="link" onClick={() => navigate(`/plans/new?date=${sel}`)}>Add plan</button>
        </div>

        {selEvents.length > 0 ? (
          <div className="group-list">
            {selEvents.map((e) => (
              <button key={e.id} className="row-item" onClick={() => navigate(`/event/${e.id}`)}>
                <span className="time-col mono">{fmtTime(e.start_at)}<small>{fmtTime(e.end_at)}</small></span>
                <span className={`bar t-${e.type}`} />
                <span className="grow"><b>{e.title}</b><small>{TYPE_LABEL[e.type]}{e.rsvp && e.rsvp !== 'going' ? ` · you said ${e.rsvp}` : ''}</small></span>
                <Icon name="right" size={18} className="muted" />
              </button>
            ))}
          </div>
        ) : null}

        <button className="group-list row-item ask" onClick={() => openPlanner(`Plan something ${sel === today ? 'today' : `on ${fmtLongDay(selDate)}`} `)}>
          <Orb size={40} />
          <span className="grow">
            <b>{selEvents.length ? 'Add something else' : 'Nothing planned'}</b>
            <small>{freeFriends ? `${freeFriends} friend${freeFriends > 1 ? 's are' : ' is'} free ${dayWord}. Ask Planner to set it up.` : `Ask Planner to plan ${dayWord}.`}</small>
          </span>
          <Icon name="right" size={18} />
        </button>
      </section>

      {users.length > 1 && (
        <section>
          <h2 className="list-label">Who's free {dayWord}</h2>
          <div className="who-grid">
            {selRows.filter((r) => !r.u.me).map(({ u, state, blocks, evs = [] }) => {
              const detail = [...blocks.filter((b) => b.start_time && b.kind !== 'free').map((b) => `${b.kind === 'work' ? 'work' : 'busy'} ${b.start_time}–${b.end_time}`),
                ...evs.map((e) => `busy ${fmtTime(e.start_at)}–${fmtTime(e.end_at)}`)].slice(0, 2).join(', ');
              return (
                <div key={u.id} className="who-cell" style={{ '--s': STATE[state].color }}>
                  <span className="ring"><Avatar user={u} size={44} /></span>
                  <b>{u.display_name.split(' ')[0]}</b>
                  <small>{state === 'partial' && detail ? detail : STATE[state].label}</small>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="list-label">You on {sel === today ? 'this day' : selDate.toLocaleDateString('en-GB', { weekday: 'long' })}</h2>
        <div className="seg">
          {[['free', 'Free'], ['busy', 'Busy'], ['work', 'At work']].map(([k, l]) => (
            <button key={k} className={myAllDay === k ? 'on' : ''} onClick={() => setDay(k)}>{l}</button>
          ))}
        </div>
        {myBlocks.filter((b) => b.start_time).length > 0 && (
          <div className="group-list mt">
            {myBlocks.filter((b) => b.start_time).map((b) => (
              <div key={b.id} className="row-item">
                <span className="time-col mono">{b.start_time}<small>{b.end_time}</small></span>
                <span className="bar" style={{ background: b.kind === 'work' ? 'var(--blue)' : 'var(--danger)' }} />
                <span className="grow"><b>{b.kind === 'work' ? 'Work' : 'Busy'}</b>{b.note && <small>{b.note}</small>}</span>
                <button className="icon-btn sm" onClick={async () => { await del(`/availability/${b.id}`); load(); }} aria-label="Remove"><Icon name="x" size={18} /></button>
              </div>
            ))}
          </div>
        )}
        <button className="btn block" onClick={() => setBlockOpen(true)}><Icon name="block" size={18} />Block out a few hours</button>
      </section>

      <Sheet open={blockOpen} onClose={() => setBlockOpen(false)} title="Block out time">
        <div className="form">
          <p className="muted small">Friends see you as busy then. Planner won't book over it.</p>
          <div className="seg">
            {[['busy', 'Busy'], ['work', 'Work']].map(([k, l]) => <button key={k} className={block.kind === k ? 'on' : ''} onClick={() => setBlock({ ...block, kind: k })}>{l}</button>)}
          </div>
          <div className="grid2">
            <label>From<input type="time" value={block.start_time} onChange={(e) => setBlock({ ...block, start_time: e.target.value })} /></label>
            <label>Until<input type="time" value={block.end_time} onChange={(e) => setBlock({ ...block, end_time: e.target.value })} /></label>
          </div>
          <input placeholder="Note, only you see it (optional)" value={block.note} onChange={(e) => setBlock({ ...block, note: e.target.value })} />
          <button className="btn primary block" onClick={addBlock}>Save</button>
        </div>
      </Sheet>
    </>
  );
}
