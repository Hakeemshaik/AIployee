import { useEffect, useState } from 'react';
import { get, post } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Header, Sheet, Icon, Empty } from '../components/ui.jsx';
import { fmtTime, dayKey, addDays } from '../lib/dates.js';

const when = (iso) => {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(new Date())) return fmtTime(d);
  if (dayKey(d) === dayKey(addDays(new Date(), -1))) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export default function Calls() {
  const { friends, navigate, toast } = useApp();
  const [calls, setCalls] = useState(null);
  const [pick, setPick] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = () => get('/calls').then((r) => setCalls(r.calls)).catch(() => setCalls([]));
  useEffect(() => { load(); }, []);
  useSocket('invite', load);
  useSocket('notification', (n) => n.kind === 'invite_response' && load());

  const call = async (people) => {
    try { const r = await post('/invites', { to_ids: people.map((p) => p.id), kind: 'call' }); navigate(`/call/${r.room_id}`); }
    catch (x) { toast({ title: 'Could not call', body: x.message }); }
  };

  const list = (calls || []).filter((c) => filter === 'all' || c.missed);
  const favourites = [...friends.friends].sort((a, b) => b.online - a.online).slice(0, 4);

  return (
    <>
      <Header title="Calls" right={<button className="icon-plain accent" onClick={() => setPick(true)} aria-label="New call"><Icon name="plus" size={26} /></button>} />

      {favourites.length > 0 && (
        <>
          <div className="list-label">Quick call</div>
          <div className="fav-row">
            {favourites.map((f) => (
              <button key={f.id} className="fav" onClick={() => call([f])}>
                <Avatar user={f} size={58} showStatus={f.online} />
                <span>{f.display_name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="filters">
        {[['all', 'All'], ['missed', 'Missed']].map(([k, l]) => <button key={k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>

      {calls && list.length === 0 && <Empty title={filter === 'missed' ? 'No missed calls' : 'No calls yet'}>Tap a friend above to video call them. Their phone rings.</Empty>}
      {list.length > 0 && (
        <div className="group-list">
          {list.map((c) => (
            <div key={c.id} className="row-item">
              {c.people.length > 1
                ? <span className="stack">{c.people.slice(0, 2).map((p) => <Avatar key={p.id} user={p} size={36} />)}</span>
                : <Avatar user={c.people[0]} size={46} />}
              <span className="grow">
                <b className={c.missed ? 'danger' : ''}>{c.people.map((p) => p.display_name.split(' ')[0]).join(', ')}</b>
                <small className="call-line">
                  <Icon name={c.outgoing ? 'arrowOut' : 'arrowIn'} size={15} className={c.missed ? 'danger' : 'ok'} />
                  {c.outgoing ? 'Outgoing' : c.missed ? 'Missed' : 'Incoming'} · {when(c.created_at)}
                </small>
              </span>
              <button className="icon-plain accent" onClick={() => call(c.people)} aria-label="Call back"><Icon name="video" size={24} /></button>
            </div>
          ))}
        </div>
      )}

      <Sheet open={pick} onClose={() => setPick(false)} title="New call">
        <div className="sheet-list">
          {friends.friends.length === 0 && <p className="muted">Add friends first.</p>}
          {friends.friends.map((f) => (
            <div key={f.id} className="row-item">
              <Avatar user={f} size={44} showStatus={f.online} />
              <span className="grow"><b>{f.display_name}</b><small>{f.online ? 'Online' : 'Offline'}</small></span>
              <button className="icon-plain accent" onClick={() => { setPick(false); call([f]); }} aria-label={`Video call ${f.display_name}`}><Icon name="video" size={24} /></button>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
