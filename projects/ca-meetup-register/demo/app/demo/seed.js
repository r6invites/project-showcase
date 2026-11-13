// SAMPLE DATA. Everything below is made up: invented names, 900000xxxx phone numbers, example addresses.
// It is created by calling the app's own database functions (the same path a real registration takes),
// then the dates are spread over the last days so the dashboard looks lived-in.
import { USERS } from './core.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FIRST = ['Aarav','Diya','Kabir','Meera','Rohan','Ananya','Vikram','Isha','Arjun','Nisha','Farhan','Sana','Rahul','Priya','Imran','Zoya','Karthik','Lakshmi','Ayaan','Fiza','Sanjay','Tara','Yusuf','Noor','Dev','Riya','Aditya','Mehak','Joel','Anita','Nikhil','Sneha','Rizwan','Pooja','Varun','Hana','Manav','Leela','Omar','Kavya','Tejas','Amira','Neel','Shruti'];
const LAST = ['Menon','Shah','Rao','Khan','Nair','Gupta','Iyer','Joseph','Patel','Kumar','Bhat','Das','Reddy','Mathew','Sheikh','Pillai','Verma','Hegde','Thomas','Naik'];
const OCC = [['Article Assistant', 'Sample & Associates'], ['Article Assistant', 'Demo Partners LLP'], ['Industrial Trainee', 'Sample Industries Ltd'], ['Employee', 'Demo Tech Pvt Ltd'], ['Student', 'Sample Commerce College'], ['Others', 'Freelance (sample)']];

export async function seed(be, progress, hooks = {}) {
  const say = (p, t) => { try { progress && progress(p, t); } catch (_) {} };
  const R = rng(20261111), pick = a => a[Math.floor(R() * a.length)];
  const ANON = ip => ({ role: 'anon', ip }), ADMIN = { role: 'authenticated', uid: USERS.admin.id, ip: '198.51.100.10' };
  const uuid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ Math.floor(R() * 16) >> c / 4).toString(16)));
  const now = Date.now(), DAY = 864e5;
  const step = async (label, fn) => { try { return await fn(); } catch (e) { console.warn('[demo seed] ' + label + ': ' + (e && e.message)); return null; } };

  // ---- settings (done as the admin, so the "what changed" log shows a person, not a robot) ----------------
  const event = new Date('2026-11-22T08:30:00Z');   // same date and venue the pages already show (2 PM IST)
  await step('settings', async () => {
    await be.sql("update public.settings set is_open=true, cap=150, price_per_head=250, max_group=5, ip_flag_threshold=5");
    await be.rpc(ADMIN, 'admin_update_settings', { p_cap: 150, p_price: 250, p_deadline: new Date(now + 9 * DAY).toISOString(), p_is_open: true });
    await be.rpc(ADMIN, 'admin_set_event', { p_event_at: event.toISOString(), p_venue: 'Bloom Creative Zone, Haralur' });
    await be.rpc(ADMIN, 'admin_set_payment_info', { p_upi: 'sample.events@demobank', p_payee: 'Sample Events Team', p_whatsapp: '919000000000' });
    await be.rpc(ADMIN, 'admin_set_contacts', { p_name1: 'Sample Coordinator', p_num1: '919000000000', p_name2: 'Demo Helpdesk', p_num2: '919000000001', p_name3: 'Sample Support', p_num3: '919000000002' });
    await be.rpc(ADMIN, 'admin_set_transfer_settings', { p_open: true, p_code_hours: 2 });
    await be.sql("update public.settings set event_at=$1 where id=1", [event.toISOString()]);
  });

  // ---- bookings, through the real submit function ---------------------------------------------------------
  const N = 44, plan = [];
  let phone = 9000010000;
  for (let i = 0; i < N; i++) {
    const size = R() < .45 ? 1 : R() < .6 ? 2 : R() < .7 ? 3 : R() < .8 ? 4 : 5;
    const people = [];
    for (let k = 0; k < size; k++) {
      const [occ, det] = pick(OCC);
      people.push({ name: pick(FIRST) + ' ' + pick(LAST), phone: String(phone++), occ, occ_detail: det, loc: R() < .8 ? 'In Bengaluru' : 'Outside Bengaluru', food: R() < .55 ? 'Veg' : 'Non-veg' });
    }
    // later bookings are more frequent (a registration rush near the end), oldest first
    const ageDays = 8.5 * Math.pow(1 - (i + R() * .8) / N, 1.6);
    plan.push({ sid: uuid(), people, at: new Date(now - ageDays * DAY - R() * 3 * 36e5), ip: '203.0.113.' + (20 + i) });
  }
  // six bookings from one address, so the "same device / network" flag has something to show
  for (let i = 30; i < 36; i++) plan[i].ip = '198.51.100.23';
  // two bookings that share a payment reference, so the duplicate-payment flag has something to show
  const dupRef = '420123456789';

  const made = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i], path = p.sid + '.jpg', amount = p.people.length * 250;
    const ref = (i === 14 || i === 15) ? dupRef : String(400000000000 + Math.floor(R() * 99999999999));
    if (hooks.putShot) await hooks.putShot(path, { name: p.people[0].name, amount, ref, at: p.at, upi: 'sample.events@demobank' });
    await be.registerObject('payment-proofs', path);
    const r = await be.rpc(ANON(p.ip), 'submit_booking', { p_submission_id: p.sid, p_people: p.people, p_screenshot_path: path });
    if (r.error) { console.warn('[demo seed] booking ' + i + ': ' + r.error.message); continue; }
    made.push({ i, code: r.data.booking_code, at: p.at, ref });
    say(.55 * (i + 1) / plan.length, 'Adding sample registrations');
  }

  // ---- decisions: most paid, a few rejected, the newest left pending ------------------------------------
  const rows = (await be.sql('select id, booking_code from public.bookings order by created_at')).rows;
  const idOf = Object.fromEntries(rows.map(r => [r.booking_code, r.id]));
  const total = made.length, nPending = 9, nRejected = 3;
  const decided = made.slice(0, total - nPending);
  const toReject = new Set([4, 11, 19].slice(0, nRejected).map(k => decided[k] && decided[k].code));
  const toPay = decided.filter(m => !toReject.has(m.code)).map(m => idOf[m.code]);
  await step('approve', async () => {
    for (let k = 0; k < toPay.length; k += 10) {
      const r = await be.rpc(ADMIN, 'admin_approve_bookings', { p_ids: toPay.slice(k, k + 10) });
      if (r.error) console.warn('[demo seed] approve: ' + r.error.message);
    }
  });
  await step('reject', async () => { for (const c of toReject) if (c) await be.rpc(ADMIN, 'set_booking_status', { p_booking: idOf[c], p_status: 'rejected' }); });
  say(.62, 'Adding sample registrations');

  // ---- spread the dates ---------------------------------------------------------------------------------------
  await step('dates', async () => {
    for (const m of made) {
      const created = m.at.toISOString(), decidedAt = new Date(m.at.getTime() + (1 + R() * 3) * 36e5).toISOString();
      await be.sql("update public.bookings set created_at=$2, reviewed_at = case when reviewed_at is null then null else least($3::timestamptz, now()) end where booking_code=$1", [m.code, created, decidedAt]);
      await be.sql("update public.tickets set created_at=$2 where booking_id=(select id from public.bookings where booking_code=$1)", [m.code, created]);
      await be.sql("update public.booking_ips set created_at=$2 where booking_id=(select id from public.bookings where booking_code=$1)", [m.code, created]);
    }
  });

  // the setup changes made above should read as old history, not as something the visitor just did
  await step('log dates', async () => { await be.sql("update public.settings_log set \"at\" = now() - interval '6 days' - (id * interval '7 minutes')"); });

  // ---- coordinators, prizes, messages, feedback, ticket views -------------------------------------------------
  const paid = (await be.sql("select t.id, t.name, t.phone, t.ticket_no, b.booking_code from public.tickets t join public.bookings b on b.id=t.booking_id where b.status='paid' and b.kind='registration' order by t.ticket_no")).rows;
  await step('coordinators', async () => { for (const t of paid.slice(0, 3)) await be.rpc(ADMIN, 'set_coordinator', { p_ticket_id: t.id, p_make: true }); });
  await step('messages', async () => {
    const msgs = [['Lucky star', 'Show this to the host for a small surprise.'], ['Quiz champion', 'You get to pick the table for the quiz round.'], ['Photo of the day', 'Find the host for a keepsake photo.']];
    const ids = []; for (const [n, b] of msgs) { const r = await be.rpc(ADMIN, 'admin_save_message', { p_id: null, p_name: n, p_body: b }); if (r.data) ids.push(r.data); }
    const win = paid.slice(5, 7).map(t => t.id);
    if (win.length) await be.rpc(ADMIN, 'admin_set_prizes', { p_tickets: win, p_body: 'Collect your sample gift at the help desk.', p_heading: 'You are a winner!' });
  });
  await step('feedback', async () => {
    const cm = ['Easy to register and pay.', 'The ticket page was clear.', null, 'Loved the QR ticket.'];
    for (let k = 0; k < 4; k++) { const t = paid[10 + k * 3]; if (t) await be.rpc(ANON('203.0.113.200'), 'submit_feedback', { p_booking_code: t.booking_code, p_rating: 4 + (k % 2), p_comment: cm[k] }); }
  });
  await step('views', async () => {
    for (const t of paid.slice(0, 12)) await be.rpc(ANON('203.0.113.201'), 'log_ticket_activity', { p_code: t.booking_code, p_phone: t.phone, p_action: 'view', p_tickets: null });
    for (const t of paid.slice(0, 5)) await be.rpc(ANON('203.0.113.201'), 'log_ticket_activity', { p_code: t.booking_code, p_phone: t.phone, p_action: 'jpg', p_tickets: null });
  });
  // fixed ticket secrets, so the sample QR codes shown on the demo home page scan correctly on any device
  await step('fixed codes', async () => {
    await be.sql("update public.tickets set secret = substr(md5('demo-' || reg_seq::text), 1, 12), orig_secret = case when orig_secret is not null then substr(md5('demog-' || reg_seq::text), 1, 12) end");
  });
  say(1, 'Done');
  return made.length;
}
