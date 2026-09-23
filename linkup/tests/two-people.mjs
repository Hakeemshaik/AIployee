// End-to-end check: two people sign up (one via the other's invite link), chat live, see typing + read ticks, sign out and back in.
// Run against a fresh server: DATA_DIR=/tmp/linkup-test npm start, then: npm run test:e2e
import fs from 'node:fs'; fs.mkdirSync('tests/shots', { recursive: true });
import { chromium } from 'playwright';
const B=process.env.APP_URL || 'http://localhost:8080';
const CODE=process.env.REGISTRATION_CODE || '';
const browser = await chromium.launch();
const mk=async(name)=>{const c=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,permissions:['clipboard-read','clipboard-write']});const p=await c.newPage();p.on('pageerror',e=>console.log(name,'ERR',e.message));return {c,p};};
const {c:ca,p:A}=await mk('a'); const {c:cb,p:Bp}=await mk('b');
const shot=(p,n)=>p.screenshot({path:'tests/shots/'+n+'.png'});
const log=(...a)=>console.log('✓',...a);

// --- Person 1 signs up with the invite code ---
await A.goto(B); await A.waitForTimeout(1600); await shot(A,'01-welcome');
await A.click('text=Create account'); await A.waitForSelector('.login-card'); await A.waitForTimeout(500);
await A.fill('input[autocomplete=username]','hakeem'); await A.fill('input[autocomplete=name]','Hakeem'); await A.fill('input[type=password]','secret123');
if (await A.locator('.field:has-text("Invite code")').count()) await A.fill('.field:has-text("Invite code") input', CODE); await shot(A,'02-signup');
await A.click('.login-card button.primary'); await A.waitForSelector('text=Bring your friends'); log('Person 1 signed up'); await A.waitForTimeout(600); await shot(A,'03-empty');

// --- Person 1 shares an invite link ---
await A.click('text=Share invite link'); await A.waitForSelector('.toast:has-text("Invite link copied")');
const link = await A.evaluate(()=>navigator.clipboard.readText()); const url=link.match(/https?:\/\/\S+/)[0]; log('Invite link', url.slice(0,60)+'…');

// --- Person 2 opens the link and signs up (no invite code needed) ---
await Bp.goto(url); await Bp.waitForSelector('.invite-banner'); await Bp.waitForTimeout(900); await shot(Bp,'04-invited');
await Bp.fill('input[autocomplete=username]','sipho'); await Bp.fill('input[autocomplete=name]','Sipho'); await Bp.fill('input[type=password]','secret123');
await Bp.click('.login-card button.primary'); await Bp.waitForSelector('.composer'); log('Person 2 joined via link and landed in the chat');
await Bp.waitForTimeout(700); await shot(Bp,'05-b-chat');
await A.waitForSelector('.chat-list .row-item:has-text("Sipho")'); log('Person 1 sees the new chat live'); await A.waitForTimeout(500); await shot(A,'06-a-list');

// --- They chat ---
await Bp.fill('.composer input','heyy it worked 🙌 its Sipho'); await Bp.press('.composer input','Enter');
await A.waitForSelector('.toast:has-text("heyy it worked")'); log('Person 1 got the message as a live notification'); await shot(A,'07-a-toast');
await A.click('.chat-list .row-item:has-text("Sipho")'); await A.waitForSelector('text=heyy it worked');
await A.fill('.composer input','yooo welcome! braai saturday?'); await A.press('.composer input','Enter');
await Bp.waitForSelector('text=yooo welcome'); log('Person 2 got the reply live');
await Bp.waitForTimeout(2100); await Bp.locator('.composer input').pressSequentially('say less, im in', {delay:60}); 
await A.waitForSelector('.chat-who small:has-text("typing")'); log('Person 1 sees "typing…"'); await shot(A,'08-a-typing');
await Bp.press('.composer input','Enter'); await A.waitForSelector("text=say less"); await A.waitForTimeout(800);
const readTicks = await Bp.locator('.row-msg.out .tick.read').count(); log('Read ticks on Person 2 side:', readTicks);
await shot(A,'09-a-chat'); await shot(Bp,'10-b-chat');

// --- Sign out and back in ---
await A.goto(B+'/settings'); await A.click('text=Sign out'); await A.waitForSelector('.welcome-actions'); 
await A.click('text=I already have an account'); await A.fill('input[autocomplete=username]','hakeem'); await A.fill('input[type=password]','wrongpass'); await A.click('.login-card button.primary');
await A.waitForSelector('.login-card .error'); log('Wrong password rejected'); await A.waitForTimeout(450); await shot(A,'11-wrong');
await A.fill('input[type=password]','secret123'); await A.click('.login-card button.primary'); await A.waitForSelector('.chat-list .row-item:has-text("Sipho")'); log('Signed back in, chat history still there');
await A.click('.chat-list .row-item:has-text("Sipho")'); await A.waitForSelector('text=say less'); await A.waitForTimeout(600); await shot(A,'12-a-back');
await ca.close(); await cb.close(); await browser.close(); console.log('ALL GOOD');
