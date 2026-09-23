import { useState } from 'react';
import { post, del } from '../lib/api.js';
import { useApp, STATUS } from '../lib/store.jsx';
import { Avatar, Sheet, Header, Icon, Orb, Empty } from '../components/ui.jsx';
import { ago } from '../lib/dates.js';
import { shareInvite } from '../lib/share.js';

export default function Friends() {
  const { me, friends, loadFriends, navigate, toast, openPlanner } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [sel, setSel] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    try {
      const r = await post('/friends/request', { username: name.trim() });
      toast({ title: r.accepted ? 'You are now friends' : 'Request sent', body: r.accepted ? undefined : `@${name.trim().replace(/^@/, '')} needs to accept` });
      setName(''); setAddOpen(false); loadFriends();
    } catch (x) { toast({ title: 'Could not add', body: x.message }); }
  };
  const respond = async (rid, accept) => { await post(`/friends/requests/${rid}/respond`, { accept }); loadFriends(); };
  const call = async (f) => {
    try { const r = await post('/invites', { to_ids: [f.id], kind: 'call' }); navigate(`/call/${r.room_id}`); }
    catch (x) { toast({ title: 'Could not call', body: x.message }); }
  };
  const chat = async (f) => { const r = await post('/conversations', { member_ids: [f.id] }); navigate(`/chat/${r.conversation.id}`); };
  const share = () => shareInvite(me, toast);

  const online = friends.friends.filter((f) => f.online).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const offline = friends.friends.filter((f) => !f.online).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const Row = ({ f }) => (
    <div className="row-item">
      <button className="row gap grow plain" onClick={() => setSel(f)}>
        <Avatar user={f} size={44} showStatus />
        <span className="grow">
          <b>{f.display_name}</b>
          <small>{f.online ? [STATUS[f.status]?.label, f.status_text].filter(Boolean).join(' · ') : f.last_seen ? `Last seen ${ago(f.last_seen)} ago` : 'Offline'}</small>
        </span>
      </button>
      <button className="icon-plain accent" onClick={() => chat(f)} aria-label={`Message ${f.display_name}`}><Icon name="chat" size={19} /></button>
      <button className="icon-plain accent" onClick={() => call(f)} aria-label={`Video call ${f.display_name}`}><Icon name="video" size={19} /></button>
    </div>
  );

  return (
    <>
      <Header back="/settings" title="Friends" right={<button className="icon-plain accent" onClick={() => setAddOpen(true)} aria-label="Add friend"><Icon name="userPlus" /></button>} />

      <section className="group-list me-row">
        <Avatar user={me} size={52} />
        <div className="grow">
          <b>{me?.display_name}</b>
          <small className="mono">@{me?.username}</small>
        </div>
        <button className="btn small primary" onClick={share}>Invite link</button>
      </section>

      {friends.incoming.length > 0 && (
        <section>
          <h2 className="list-label">Wants to be friends</h2>
          <div className="group-list">
            {friends.incoming.map((r) => (
              <div key={r.request_id} className="row-item">
                <Avatar user={r.user} size={40} />
                <span className="grow"><b>{r.user.display_name}</b><small className="mono">@{r.user.username}</small></span>
                <button className="btn small" onClick={() => respond(r.request_id, false)}>Ignore</button>
                <button className="btn small primary" onClick={() => respond(r.request_id, true)}>Accept</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {friends.friends.length === 0 && friends.incoming.length === 0 && (
        <Empty title="No friends yet" action={<button className="btn primary mt" onClick={share}>Share invite link</button>}>
          Send them your invite link. When they sign up with it you're connected straight away.
        </Empty>
      )}

      {online.length > 0 && (
        <section>
          <h2 className="list-label">Online · {online.length}</h2>
          <div className="group-list">{online.map((f) => <Row key={f.id} f={f} />)}</div>
        </section>
      )}
      {offline.length > 0 && (
        <section>
          <h2 className="list-label">Offline</h2>
          <div className="group-list">{offline.map((f) => <Row key={f.id} f={f} />)}</div>
        </section>
      )}
      {friends.outgoing.length > 0 && <p className="muted small pad">Waiting for {friends.outgoing.map((o) => '@' + o.user.username).join(', ')} to accept</p>}


      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a friend">
        <form onSubmit={add} className="form">
          <input autoFocus autoCapitalize="none" autoCorrect="off" placeholder="Their username" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary block" disabled={!name.trim()}>Send request</button>
          <p className="muted small center">Your username is <b className="mono">@{me?.username}</b></p>
        </form>
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.display_name}>
        {sel && (
          <div className="group-list flush">
            <p className="muted small">{sel.online ? [STATUS[sel.status]?.label, sel.status_text].filter(Boolean).join(' · ') : 'Offline'}</p>
            <button className="row-item" onClick={() => { setSel(null); call(sel); }}><span className="qi" style={{ '--c': 'var(--ok)' }}><Icon name="video" /></span><span className="grow"><b>Video call</b></span></button>
            <button className="row-item" onClick={() => { setSel(null); chat(sel); }}><span className="qi" style={{ '--c': 'var(--blue)' }}><Icon name="chat" /></span><span className="grow"><b>Message</b></span></button>
            <button className="row-item" onClick={() => { setSel(null); openPlanner(`Plan something with ${sel.display_name.split(' ')[0]} `); }}><Orb size={40} /><span className="grow"><b>Plan something together</b></span></button>
            <button className="btn block danger-text" onClick={async () => { if (confirm(`Remove ${sel.display_name}?`)) { await del(`/friends/${sel.id}`); setSel(null); loadFriends(); } }}>Remove friend</button>
          </div>
        )}
      </Sheet>
    </>
  );
}
