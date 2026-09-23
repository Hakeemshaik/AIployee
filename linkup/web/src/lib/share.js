import { get } from './api.js';

/** Share (or copy) a personal invite link. Whoever signs up with it becomes your friend instantly. */
export async function shareInvite(me, toast) {
  try {
    const { token } = await get('/invite-link');
    const url = `${location.origin}/join/${token}`;
    const text = `${me?.display_name || 'I'} invited you to Linkup. Tap to join and we'll be connected:`;
    if (navigator.share) {
      await navigator.share({ title: 'Join me on Linkup', text, url });
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast({ title: 'Invite link copied', body: 'Paste it in a message to your friend' });
    }
    return url;
  } catch (e) {
    if (e?.name !== 'AbortError') toast({ title: 'Could not share link', body: e.message });
    return null;
  }
}
