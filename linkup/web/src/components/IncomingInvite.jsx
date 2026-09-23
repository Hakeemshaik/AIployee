import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { post } from '../lib/api.js';
import { Avatar } from './ui.jsx';

// Full-screen "ringing" card for video-call and chill invites while the app is open.
export default function IncomingInvite() {
  const { incoming, setIncoming, navigate, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const audio = useRef(null);

  useEffect(() => {
    if (!incoming) return;
    const isCall = incoming.kind === 'call';
    navigator.vibrate?.(isCall ? [400, 200, 400, 200, 400] : [150, 80, 150]);
    let ctx, timer;
    if (isCall) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const ring = () => {
          [0, 0.25].forEach((t) => {
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.frequency.value = 660; g.gain.value = 0.08;
            o.connect(g).connect(ctx.destination);
            o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
          });
        };
        ring(); timer = setInterval(ring, 1800);
      } catch { /* autoplay blocked */ }
    }
    audio.current = { ctx, timer };
    const auto = setTimeout(() => setIncoming(null), 45000);
    return () => { clearInterval(timer); ctx?.close?.(); clearTimeout(auto); };
  }, [incoming, setIncoming]);

  if (!incoming) return null;
  const isCall = incoming.kind === 'call';

  const respond = async (accept) => {
    setBusy(true);
    try {
      const r = await post(`/invites/${incoming.id}/respond`, { accept });
      setIncoming(null);
      if (accept && isCall) navigate(`/call/${r.room_id}`);
      else if (accept) toast({ title: `Told ${incoming.from.display_name} you're down` });
    } catch (e) {
      toast({ title: 'Could not respond', body: e.message });
      setIncoming(null);
    } finally { setBusy(false); }
  };

  return (
    <div className="ring-backdrop">
      <div className="ring">
        <div className={isCall ? 'ring-pulse' : ''}><Avatar user={incoming.from} size={96} /></div>
        <h2>{incoming.from.display_name}</h2>
        <p className="muted">{isCall ? 'wants to video call' : 'wants to chill'}</p>
        {incoming.message && <p className="ring-msg">“{incoming.message}”</p>}
        <div className="ring-actions">
          <button className="btn danger round" disabled={busy} onClick={() => respond(false)}>Not now</button>
          <button className="btn success round" disabled={busy} onClick={() => respond(true)}>{isCall ? 'Join' : "I'm down"}</button>
        </div>
      </div>
    </div>
  );
}
