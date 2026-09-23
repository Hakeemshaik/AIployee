import { useEffect, useState } from 'react';
import { get } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Header, Empty, Icon } from '../components/ui.jsx';
import { fmtRange, relDay } from '../lib/dates.js';

export default function Plans() {
  const { me, navigate } = useApp();
  const [events, setEvents] = useState(null);
  const load = () => get('/events').then((r) => setEvents(r.events)).catch(() => setEvents([]));
  useEffect(() => { load(); }, []);
  useSocket('events:changed', load);

  const now = Date.now();
  const upcoming = (events || []).filter((e) => Date.parse(e.end_at) >= now);
  const past = (events || []).filter((e) => Date.parse(e.end_at) < now).reverse();

  const Row = ({ e }) => {
    const mine = e.members.find((m) => m.id === me?.id);
    const going = e.members.filter((m) => m.rsvp === 'going').length;
    return (
      <button className="row-item" onClick={() => navigate(`/event/${e.id}`)}>
        <span className="date-col"><b>{new Date(e.start_at).getDate()}</b><small>{new Date(e.start_at).toLocaleDateString('en-GB', { month: 'short' })}</small></span>
        <span className={`bar t-${e.type}`} />
        <span className="grow">
          <b>{e.title}</b>
          <small>{relDay(e.start_at)} · {fmtRange(e.start_at, e.end_at).split(', ').pop()}{e.location ? ` · ${e.location}` : ''}</small>
          <small>{going} going{mine?.rsvp === 'pending' && <b className="accent"> · you haven't answered</b>}</small>
        </span>
        <span className="avatars">{e.members.slice(0, 3).map((m) => <Avatar key={m.id} user={m} size={24} />)}</span>
      </button>
    );
  };

  return (
    <>
      <Header back="/settings" title="Plans" right={<button className="icon-plain accent" onClick={() => navigate('/plans/new')} aria-label="New plan"><Icon name="plus" size={26} /></button>} />
      {events && upcoming.length === 0 && <Empty title="No plans yet">Create one, or chat with friends and tap “Plan it”.</Empty>}
      {upcoming.length > 0 && <div className="group-list">{upcoming.map((e) => <Row key={e.id} e={e} />)}</div>}
      {past.length > 0 && <><h2 className="list-label">Recent</h2><div className="group-list">{past.map((e) => <Row key={e.id} e={e} />)}</div></>}
    </>
  );
}
