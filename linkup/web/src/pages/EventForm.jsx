import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Avatar, Header } from '../components/ui.jsx';
import { dayKey, fromKey, timeOf, addDays } from '../lib/dates.js';

const TYPES = [
  ['hangout', 'Hangout'], ['trip', 'Trip'], ['call', 'Video call'], ['meeting', 'Meeting'], ['event', 'Event'],
];
const DEFAULT_TIMES = { trip: ['08:00', '18:00'], meeting: ['10:00', '11:00'], call: ['19:00', '20:00'], hangout: ['18:00', '21:00'], event: ['18:00', '21:00'] };
const REMINDERS = [[5, '5 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before'], [180, '3 hours before'], [1440, '1 day before']];

export default function EventForm() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const { friends, navigate, toast } = useApp();
  const tomorrow = dayKey(addDays(new Date(), 1));
  const qType = TYPES.some(([k]) => k === qs.get('type')) ? qs.get('type') : 'hangout';
  const [f, setF] = useState({
    title: qs.get('title') || '', type: qType, date: qs.get('date') || tomorrow, end_date: '',
    start_time: qs.get('start') || DEFAULT_TIMES[qType][0], end_time: qs.get('end') || DEFAULT_TIMES[qType][1],
    location: qs.get('location') || '', notes: '', reminder_minutes: Number(qs.get('reminder')) || (qType === 'trip' ? 1440 : 60),
    participant_ids: qs.get('with') ? qs.get('with').split(',').filter(Boolean) : [],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    get(`/events/${id}`).then(({ event: e }) => setF({
      title: e.title, type: e.type, date: dayKey(e.start_at), end_date: dayKey(e.end_at) !== dayKey(e.start_at) ? dayKey(e.end_at) : '',
      start_time: timeOf(e.start_at), end_time: timeOf(e.end_at), location: e.location, notes: e.notes,
      reminder_minutes: e.reminder_minutes, participant_ids: e.members.map((m) => m.id),
    }));
  }, [id]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setType = (type) => {
    const [s, e] = DEFAULT_TIMES[type];
    setF({ ...f, type, start_time: s, end_time: e, reminder_minutes: type === 'trip' ? 1440 : f.reminder_minutes });
  };
  const toggle = (uid) => setF({ ...f, participant_ids: f.participant_ids.includes(uid) ? f.participant_ids.filter((x) => x !== uid) : [...f.participant_ids, uid] });

  const submit = async (e) => {
    e.preventDefault();
    const start = fromKey(f.date, f.start_time);
    let end = fromKey(f.end_date || f.date, f.end_time);
    if (end <= start) end = new Date(start.getTime() + 2 * 3600000);
    const body = { ...f, start_at: start.toISOString(), end_at: end.toISOString(), reminder_minutes: +f.reminder_minutes };
    setBusy(true);
    try {
      if (id) {
        await patch(`/events/${id}`, { ...body, add_participant_ids: f.participant_ids });
        navigate(`/event/${id}`, { replace: true });
      } else {
        const r = await post('/events', body);
        toast({ title: 'Plan created', body: f.participant_ids.length ? 'Invites sent' : undefined });
        navigate(`/event/${r.event.id}`, { replace: true });
      }
    } catch (x) { toast({ title: 'Could not save', body: x.message }); } finally { setBusy(false); }
  };

  return (
    <>
      <Header title={id ? 'Edit plan' : 'New plan'} back="/plans" />
      <form className="form pad-x" onSubmit={submit}>
        <div className="chips">
          {TYPES.map(([k, l]) => <button type="button" key={k} className={`chip ${f.type === k ? 'on' : ''}`} onClick={() => setType(k)}>{l}</button>)}
        </div>
        <label>What<input required placeholder={f.type === 'trip' ? 'Durban weekend' : 'Braai at mine'} value={f.title} onChange={set('title')} /></label>
        <div className="grid2">
          <label>Date<input type="date" required value={f.date} onChange={set('date')} /></label>
          {f.type === 'trip' ? <label>Until<input type="date" value={f.end_date} min={f.date} onChange={set('end_date')} /></label> : <span />}
          <label>Starts<input type="time" value={f.start_time} onChange={set('start_time')} /></label>
          <label>Ends<input type="time" value={f.end_time} onChange={set('end_time')} /></label>
        </div>
        {f.type !== 'call' && <label>Where<input placeholder="Place or address" value={f.location} onChange={set('location')} /></label>}
        <label>Notes<textarea rows={3} placeholder="Who brings what, budget, dress code…" value={f.notes} onChange={set('notes')} /></label>
        <label>Remind everyone
          <select value={f.reminder_minutes} onChange={set('reminder_minutes')}>
            {REMINDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!REMINDERS.some(([v]) => v === +f.reminder_minutes) && <option value={f.reminder_minutes}>{f.reminder_minutes} min before</option>}
          </select>
        </label>
        <div className="label">Invite</div>
        <div className="pick">
          {friends.friends.length === 0 && <span className="muted small">Add friends on Home first.</span>}
          {friends.friends.map((u) => (
            <button type="button" key={u.id} className={`pick-item ${f.participant_ids.includes(u.id) ? 'on' : ''}`} onClick={() => toggle(u.id)}>
              <Avatar user={u} size={36} /><span>{u.display_name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <button className="btn primary block" disabled={busy}>{id ? 'Save changes' : 'Create & send invites'}</button>
      </form>
    </>
  );
}
