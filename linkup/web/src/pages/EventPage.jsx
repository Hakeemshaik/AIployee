import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post, del } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Header, Empty, Icon, TYPE_LABEL, reminderLabel } from '../components/ui.jsx';
import { fmtRange } from '../lib/dates.js';

const RSVP = { going: 'Going', maybe: 'Maybe', declined: "Can't", pending: 'No answer' };

export default function EventPage() {
  const { id } = useParams();
  const [qs, setQs] = useSearchParams();
  const { me, navigate, toast } = useApp();
  const [e, setE] = useState(null);
  const [err, setErr] = useState('');
  const acted = useRef(false);

  const load = () => get(`/events/${id}`).then((r) => setE(r.event)).catch((x) => setErr(x.message));
  useEffect(() => { load(); }, [id]);
  useSocket('events:changed', (p) => p.event_id === id && load());

  const rsvp = async (v) => {
    const r = await post(`/events/${id}/rsvp`, { rsvp: v });
    setE(r.event);
  };

  // Came from a notification action button (Going / Maybe)
  useEffect(() => {
    const act = qs.get('act');
    if (e && act && !acted.current && ['going', 'maybe', 'declined'].includes(act)) {
      acted.current = true;
      rsvp(act).then(() => toast({ title: `Marked as ${RSVP[act]}` }));
      setQs({}, { replace: true });
    }
  }, [e]); // eslint-disable-line

  if (err) return <><Header title="Plan" back="/plans" /><Empty title="Can't open this plan">{err}</Empty></>;
  if (!e) return <><Header title="" back="/plans" /><div className="spinner" /></>;

  const mine = e.members.find((m) => m.id === me?.id);
  const isCreator = e.creator_id === me?.id;
  const live = Date.parse(e.start_at) - 15 * 60000 < Date.now() && Date.parse(e.end_at) > Date.now();

  return (
    <>
      <Header back="/plans" right={isCreator && <button className="btn small" onClick={() => navigate(`/event/${id}/edit`)}>Edit</button>} />
      <section className="group-list event-hero">
        <div className="overline violet">{TYPE_LABEL[e.type]}</div>
        <h1 className="event-title">{e.title}</h1>
        <div className="meta-row"><Icon name="clock" size={17} /><span className="mono">{fmtRange(e.start_at, e.end_at)}</span></div>
        {e.location && <div className="meta-row"><Icon name="pin" size={17} /><a href={`https://maps.google.com/?q=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer">{e.location}</a></div>}
        <div className="meta-row reward"><Icon name="bell" size={17} /><span className="mono">Reminder {reminderLabel(e.reminder_minutes)}</span></div>
        {e.notes && <p className="notice-notes">{e.notes}</p>}
        <p className="muted small">Planned by {isCreator ? 'you' : e.creator.display_name}</p>
        <div className="row gap mt">
          {e.type === 'call' && e.call_room && (
            <button className="btn primary grow" onClick={() => navigate(`/call/${e.call_room}`)}><Icon name="video" size={18} />{live ? 'Join now' : 'Open call'}</button>
          )}
          {e.conversation_id && <button className="btn grow" onClick={() => navigate(`/chat/${e.conversation_id}`)}><Icon name="chat" size={18} />Chat</button>}
        </div>
      </section>

      {mine && (
        <section>
          <h2 className="list-label">Are you going?</h2>
          <div className="seg">
            {['going', 'maybe', 'declined'].map((v) => (
              <button key={v} className={mine.rsvp === v ? 'on' : ''} onClick={() => rsvp(v)}>{RSVP[v]}</button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="list-label">Who's coming · {e.members.filter((m) => m.rsvp === 'going').length} going</h2>
        <div className="group-list">
          {e.members.map((m) => (
            <div key={m.id} className="row-item">
              <Avatar user={m} size={38} />
              <span className="grow"><b>{m.id === me?.id ? 'You' : m.display_name}</b></span>
              <span className={`rsvp r-${m.rsvp}`}>{RSVP[m.rsvp]}</span>
            </div>
          ))}
        </div>
      </section>

      {isCreator && (
        <button className="btn quiet danger-text block" onClick={async () => { if (confirm('Cancel this plan for everyone?')) { await del(`/events/${id}`); navigate('/plans', { replace: true }); } }}>
          Cancel plan
        </button>
      )}
    </>
  );
}
