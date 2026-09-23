import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Avatar, Header, Empty } from '../components/ui.jsx';
import { ago } from '../lib/dates.js';

// Landing page for invite notifications (tap / Join / Not now action buttons).
export default function InvitePage() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const { me, navigate, setIncoming } = useApp();
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const acted = useRef(false);

  const respond = async (accept, i = inv) => {
    const r = await post(`/invites/${id}/respond`, { accept });
    setIncoming(null);
    if (accept && i.kind === 'call') return navigate(`/call/${r.room_id}`, { replace: true });
    if (accept) {
      const c = await post('/conversations', { member_ids: [i.from_id] });
      return navigate(`/chat/${c.conversation.id}`, { replace: true });
    }
    setDone('Declined');
  };

  useEffect(() => {
    get(`/invites/${id}`).then(({ invite }) => {
      setInv(invite);
      const act = qs.get('act');
      if (invite.to_id === me?.id && invite.status === 'pending' && act && !acted.current) (acted.current = true) && respond(act === 'accept', invite).catch((e) => setErr(e.message));
    }).catch((e) => setErr(e.message));
  }, [id, me?.id]); // eslint-disable-line

  if (err) return <><Header title="Invite" back="/" /><Empty title="Can't open invite">{err}</Empty></>;
  if (!inv) return <div className="spinner" />;
  const isCall = inv.kind === 'call';
  return (
    <>
      <Header title="Invite" back="/" />
      <section className="card center">
        <Avatar user={inv.from} size={80} />
        <h2>{inv.from.display_name} {isCall ? 'wants to video call' : 'wants to chill'}</h2>
        {inv.message && <p>“{inv.message}”</p>}
        <p className="muted small">{ago(inv.created_at)} ago · {done || inv.status}</p>
        {inv.status === 'pending' && !done && inv.to_id === me?.id && (
          <div className="row gap mt">
            <button className="btn grow" onClick={() => respond(false)}>Not now</button>
            <button className="btn primary grow" onClick={() => respond(true)}>{isCall ? 'Join call' : "I'm down"}</button>
          </div>
        )}
        {isCall && inv.status === 'accepted' && <button className="btn primary block mt" onClick={() => navigate(`/call/${inv.room_id}`)}>Rejoin call</button>}
      </section>
    </>
  );
}
