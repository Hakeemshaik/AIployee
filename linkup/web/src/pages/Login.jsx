import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Orb, Avatar, Icon } from '../components/ui.jsx';

const inviteFromPath = () => (location.pathname.match(/^\/join\/([^/]+)/) || [])[1] || null;

export default function Login() {
  const { login, config } = useApp();
  const invite = inviteFromPath();
  const [inviter, setInviter] = useState(null);
  const [step, setStep] = useState(invite ? 'register' : 'welcome'); // welcome | login | register
  const [f, setF] = useState({ username: '', display_name: '', password: '', code: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const userRef = useRef(null);

  useEffect(() => {
    if (!invite) return;
    try { sessionStorage.setItem('linkup_invite', invite); } catch { /* ignore */ }
    get(`/invite-link/${invite}`).then((r) => setInviter(r.user)).catch(() => setErr('This invite link has expired. You can still create an account.'));
  }, [invite]);
  useEffect(() => { if (step !== 'welcome') setTimeout(() => userRef.current?.focus(), 350); }, [step]);

  const set = (k) => (e) => setF({ ...f, [k]: k === 'username' ? e.target.value.replace(/\s/g, '') : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const body = step === 'login' ? { username: f.username, password: f.password } : { ...f, invite };
      const r = await post(step === 'login' ? '/auth/login' : '/auth/register', body);
      login(r.token, r.user);
    } catch (x) {
      setErr(x.message); setShake((n) => n + 1);
    } finally { setBusy(false); }
  };

  const needCode = step === 'register' && config?.registrationCodeRequired && !inviter;

  return (
    <div className="login">
      <div className="blobs" aria-hidden="true"><i /><i /><i /></div>

      <div className={`login-hero ${step !== 'welcome' ? 'up' : ''}`}>
        <div className="float"><Orb size={step === 'welcome' ? 128 : 76} state="speaking" /></div>
        <h1 className="wordmark" aria-label="Linkup">{'Linkup'.split('').map((c, i) => <span key={i} style={{ animationDelay: `${120 + i * 60}ms` }}>{c}</span>)}</h1>
        <p className="tagline">Your people. Your plans. One chat.</p>
      </div>

      {inviter && (
        <div className="invite-banner">
          <Avatar user={inviter} size={36} />
          <span><b>{inviter.display_name}</b> invited you. Sign up and you're connected straight away.</span>
        </div>
      )}

      {step === 'welcome' ? (
        <div className="welcome-actions">
          <button className="btn primary block big-btn" onClick={() => setStep('register')}>Create account</button>
          <button className="btn quiet block" onClick={() => setStep('login')}>I already have an account</button>
          <ul className="perks">
            <li><Icon name="chat" size={18} />Chat and video call your friends</li>
            <li><Icon name="cal" size={18} />See who's free and plan together</li>
            <li><Icon name="bell" size={18} />Planner books it and reminds everyone</li>
          </ul>
        </div>
      ) : (
        <form key={shake} onSubmit={submit} className={`login-card ${shake ? 'shake' : ''}`}>
          <div className="seg">
            <button type="button" className={step === 'register' ? 'on' : ''} onClick={() => { setStep('register'); setErr(''); }}>Create account</button>
            <button type="button" className={step === 'login' ? 'on' : ''} onClick={() => { setStep('login'); setErr(''); }}>Sign in</button>
          </div>
          <label className="field">
            <input ref={userRef} autoComplete="username" autoCapitalize="none" autoCorrect="off" placeholder=" " value={f.username} onChange={set('username')} required />
            <span>Username</span>
          </label>
          {step === 'register' && (
            <label className="field">
              <input autoComplete="name" placeholder=" " value={f.display_name} onChange={set('display_name')} />
              <span>Your name (what friends see)</span>
            </label>
          )}
          <label className="field">
            <input type={show ? 'text' : 'password'} autoComplete={step === 'login' ? 'current-password' : 'new-password'} placeholder=" " value={f.password} onChange={set('password')} required minLength={6} />
            <span>Password</span>
            <button type="button" className="peek" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </label>
          {needCode && (
            <label className="field">
              <input placeholder=" " value={f.code} onChange={set('code')} required />
              <span>Invite code</span>
            </label>
          )}
          {err && <p className="error">{err}</p>}
          <button className="btn primary block big-btn" disabled={busy}>
            {busy ? <span className="btn-spin" /> : step === 'login' ? 'Sign in' : inviter ? `Join ${inviter.display_name.split(' ')[0]}` : 'Create account'}
          </button>
          {step === 'register' && <p className="muted small center">Usernames are 3 to 20 letters or numbers. Friends add you with it.</p>}
        </form>
      )}
    </div>
  );
}
