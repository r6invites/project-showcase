// DEMO BACKEND (core). Runs the app's real database rules (the same SQL the live app uses) inside the browser
// with PGlite, and answers the same calls the pages make to Supabase. All data here is sample data and lives
// only in the visitor's own browser.
export const USERS = {
  admin: { id: '00000000-0000-4000-8000-0000000000a1', email: 'admin@demo.example', password: 'demo-admin', name: 'Demo Admin', role: 'admin' },
  gate:  { id: '00000000-0000-4000-8000-0000000000a2', email: 'gate@demo.example',  password: 'demo-gate',  name: 'Demo Gate Desk', role: 'gate' }
};

const ident = s => { if (!/^[A-Za-z0-9_]+$/.test(s)) throw new Error('bad identifier'); return s; };
const errOut = e => ({ data: null, error: { message: String(e && e.message || e), code: e && e.code || '', details: e && e.detail || null, hint: e && e.hint || null } });

export class Backend {
  constructor(db) { this.db = db; this.meta = {}; }

  // ---- open / build -------------------------------------------------------------------------------------
  static async open({ PGlite, dataDir, db: given, parts, seed, progress }) {
    const say = (p, t) => { try { progress && progress(p, t); } catch (_) {} };
    const db = given || new PGlite(dataDir); await db.waitReady;
    const be = new Backend(db);
    await db.exec('set check_function_bodies = off');
    const has = (await db.query("select to_regclass('public.settings') is not null as ok, to_regclass('public.demo_meta') is not null as m")).rows[0];
    let fresh = false;
    if (has.ok && has.m) {
      const m = (await db.query('select built_at from public.demo_meta limit 1')).rows[0];
      const ageDays = m ? (Date.now() - new Date(m.built_at).getTime()) / 864e5 : 999;
      if (ageDays > 6) { await db.close(); throw Object.assign(new Error('STALE'), { stale: true }); }
    } else {
      fresh = true;
      say(0.05, 'Setting up the demo database');
      let pass1 = false, i = 0;
      for (const p of parts) {
        i++;
        if (p.startsWith('-- functions, pass 1')) { pass1 = true; continue; }
        if (p.startsWith('-- functions, pass 2')) { pass1 = false; continue; }
        try { await db.exec(p.replace(/create extension if not exists pgcrypto with schema extensions;/, '')); }
        catch (e) { if (!pass1) throw e; }
        if (i % 20 === 0) say(0.05 + 0.35 * i / parts.length, 'Setting up the demo database');
      }
      await db.exec(`
        create schema if not exists storage; create table if not exists storage.objects(bucket_id text, name text);
        grant usage on schema storage to anon, authenticated; grant select on storage.objects to anon, authenticated;
        alter table public.settings_log alter column id add generated always as identity;
        alter table public.tickets alter column reg_seq add generated always as identity;
        create table public.demo_meta(built_at timestamptz not null default now());
        insert into public.demo_meta default values;
        revoke all on public.demo_meta from anon, authenticated;`);
      try { await db.exec('alter table public.ticket_activity alter column id add generated always as identity'); } catch (_) {}
      for (const u of Object.values(USERS)) {
        await db.query('insert into auth.users(id,email) values ($1,$2)', [u.id, u.email]);
        await db.query('insert into public.staff(user_id,name,role) values ($1,$2,$3)', [u.id, u.name, u.role]);
      }
    }
    await be.loadMeta();
    if (fresh && seed) { say(0.45, 'Adding sample registrations'); await seed(be, (p, t) => say(0.45 + 0.55 * p, t)); }
    say(1, 'Ready');
    return be;
  }

  async loadMeta() {
    const r = await this.db.query(`select p.proname n, p.proretset s, p.prorettype::regtype::text rt, p.proargnames an,
      (select array_agg(format_type(t,null) order by o) from unnest(p.proargtypes) with ordinality u(t,o)) ty
      from pg_proc p join pg_namespace x on x.oid=p.pronamespace where x.nspname='public'`);
    this.meta = {};
    for (const f of r.rows) { const a = {}; (f.an || []).forEach((n, i) => { if (n) a[n] = (f.ty || [])[i]; }); this.meta[f.n] = { setof: f.s, ret: f.rt, args: a }; }
  }

  // ---- run something as a given visitor ---------------------------------------------------------------
  // ctx = { role: 'anon' | 'authenticated' | 'postgres', uid, ip }
  async asCtx(ctx, fn) {
    return this.db.transaction(async tx => {
      if (ctx.role !== 'postgres') await tx.exec('set local role ' + ident(ctx.role));
      await tx.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.headers',$2,true)",
        [ctx.uid || '', JSON.stringify(ctx.ip ? { 'cf-connecting-ip': ctx.ip } : {})]);
      return fn(tx);
    });
  }

  // supabase.rpc(name, args)
  async rpc(ctx, name, args) {
    try {
      const m = this.meta[name];
      if (!m) return { data: null, error: { message: 'Could not find the function public.' + name + ' in the schema cache', code: 'PGRST202', details: null, hint: null } };
      const keys = Object.keys(args || {}).filter(k => args[k] !== undefined), params = [], bits = [];
      keys.forEach((k, i) => { const ty = m.args[k]; if (!ty) throw new Error('unknown argument ' + k); bits.push(ident(k) + ' => $' + (i + 1) + '::' + ty); params.push(args[k]); });
      const call = 'public.' + ident(name) + '(' + bits.join(', ') + ')';
      const sql = m.setof ? "select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) r from " + call + ' x'
        : (m.ret === 'void' ? 'select ' + call + ' as r' : 'select to_jsonb(' + call + ') r');
      const res = await this.asCtx(ctx, tx => tx.query(sql, params));
      return { data: m.ret === 'void' ? null : res.rows[0].r, error: null };
    } catch (e) { return errOut(e); }
  }

  // supabase.from(table).select(...)...  (the pages only read)
  from(ctx, table) {
    const be = this, st = { cols: '*', where: [], params: [], order: [], limit: null, mode: 'many' };
    const b = {
      select(c) { st.cols = c || '*'; return b; },
      eq(c, v) { st.params.push(v); st.where.push(ident(c) + ' = $' + st.params.length); return b; },
      neq(c, v) { st.params.push(v); st.where.push(ident(c) + ' <> $' + st.params.length); return b; },
      gt(c, v) { st.params.push(v); st.where.push(ident(c) + ' > $' + st.params.length); return b; },
      gte(c, v) { st.params.push(v); st.where.push(ident(c) + ' >= $' + st.params.length); return b; },
      lt(c, v) { st.params.push(v); st.where.push(ident(c) + ' < $' + st.params.length); return b; },
      lte(c, v) { st.params.push(v); st.where.push(ident(c) + ' <= $' + st.params.length); return b; },
      is(c, v) { st.where.push(ident(c) + (v === null ? ' is null' : v ? ' is true' : ' is false')); return b; },
      in(c, vs) { st.params.push(vs); st.where.push(ident(c) + ' = any($' + st.params.length + ')'); return b; },
      order(c, o) { st.order.push(ident(c) + (o && o.ascending === false ? ' desc' : ' asc')); return b; },
      limit(n) { st.limit = Math.max(0, parseInt(n, 10) || 0); return b; },
      single() { st.mode = 'single'; return b; },
      maybeSingle() { st.mode = 'maybe'; return b; },
      async _run() {
        try {
          if (!/^[A-Za-z0-9_,*\s]+$/.test(st.cols)) throw new Error('unsupported column list');
          const inner = 'select ' + st.cols + ' from public.' + ident(table) + (st.where.length ? ' where ' + st.where.join(' and ') : '') +
            (st.order.length ? ' order by ' + st.order.join(', ') : '') + (st.limit != null ? ' limit ' + st.limit : '');
          const res = await be.asCtx(ctx, tx => tx.query("select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) r from (" + inner + ') x', st.params));
          const rows = res.rows[0].r;
          if (st.mode === 'many') return { data: rows, error: null };
          if (rows.length === 1) return { data: rows[0], error: null };
          if (st.mode === 'maybe' && rows.length === 0) return { data: null, error: null };
          return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: null, hint: null } };
        } catch (e) { return errOut(e); }
      },
      then(res, rej) { return b._run().then(res, rej); }
    };
    return b;
  }

  // a file was saved to storage: the database checks this list when a booking is submitted
  async registerObject(bucket, name) {
    await this.asCtx({ role: 'postgres' }, tx => tx.query('insert into storage.objects(bucket_id,name) values ($1,$2)', [bucket, name]));
  }
  async hasObject(bucket, name) {
    const r = await this.asCtx({ role: 'postgres' }, tx => tx.query('select 1 from storage.objects where bucket_id=$1 and name=$2', [bucket, name]));
    return r.rows.length > 0;
  }
  async sql(q, params) { return this.asCtx({ role: 'postgres' }, tx => tx.query(q, params || [])); }
}
