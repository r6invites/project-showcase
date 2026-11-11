/* DEMO BACKEND. Replaces the Supabase library on these pages. It answers the same calls, using a private copy of the
   app's real database (PGlite) that lives in this browser only. Nothing here talks to any real service. */
(function () {
  'use strict';
  var script = document.currentScript, BASE = script.src.replace(/[^\/]*(\?.*)?$/, '');
  var OVERLAY = script.getAttribute('data-overlay') !== 'off';
  var DB_NAME = 'ehsaas-demo-v1', FILES = 'ehsaas-demo-files-v1', SESSION_KEY = 'ehsaas_demo_session';
  var listeners = [], state = { p: 0, t: 'Starting' };
  function progress(p, t) { state = { p: p, t: t }; listeners.forEach(function (f) { try { f(p, t); } catch (e) {} }); }

  // ---- loading screen ------------------------------------------------------------------------------------------
  var ov = null;
  function showOverlay() {
    if (!OVERLAY || ov) return;
    ov = document.createElement('div');
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#fffdf8;color:#1c1b19;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px');
    ov.innerHTML = '<div style="max-width:320px"><div style="font-weight:700;font-size:18px;margin-bottom:6px">Preparing the demo</div>' +
      '<div id="dm-t" style="opacity:.75;margin-bottom:14px">Starting</div>' +
      '<div style="height:6px;background:#e9e4d8;border-radius:99px;overflow:hidden"><div id="dm-b" style="height:100%;width:3%;background:#1f7a5a;transition:width .3s"></div></div>' +
      '<div style="opacity:.6;font-size:12.5px;margin-top:14px">First visit only: a private copy of the app&rsquo;s database is being set up in your browser. It uses sample data and nothing leaves your device.</div></div>';
    (document.body || document.documentElement).appendChild(ov);
    listeners.push(function (p, t) { var b = document.getElementById('dm-b'), x = document.getElementById('dm-t'); if (b) b.style.width = Math.max(3, Math.round(p * 100)) + '%'; if (x) x.textContent = t; });
  }
  function hideOverlay() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); ov = null; }
  if (OVERLAY) { if (document.body) showOverlay(); else document.addEventListener('DOMContentLoaded', showOverlay); }

  // ---- files (payment screenshots) kept in this browser ---------------------------------------------------------
  var filesDb = null;
  var memFiles = {}, useMem = false;
  function idb() {
    if (filesDb) return filesDb;
    filesDb = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no storage'));
      var r = indexedDB.open(FILES, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('f'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return filesDb;
  }
  function fget(k) { if (useMem) return Promise.resolve(memFiles[k] || null); return idb().catch(function () { useMem = true; return null; }).then(function (d) { if (!d) return memFiles[k] || null;  return new Promise(function (res, rej) { var q = d.transaction('f').objectStore('f').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { rej(q.error); }; }); }); }
  function fput(k, v) { if (useMem) { memFiles[k] = v; return Promise.resolve(); } return idb().catch(function () { useMem = true; return null; }).then(function (d) { if (!d) { memFiles[k] = v; return; }  return new Promise(function (res, rej) { var t = d.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }

  // sample payment screenshot (drawn here, so it can be read by the admin page's scanner just like a real one)
  function drawShot(o) {
    var c = document.createElement('canvas'); c.width = 720; c.height = 1280; var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 720, 1280);
    g.fillStyle = '#eef7f1'; g.fillRect(0, 0, 720, 520);
    g.fillStyle = '#1f9d5c'; g.beginPath(); g.arc(360, 150, 62, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(330, 150); g.lineTo(352, 174); g.lineTo(392, 126); g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#146c3f'; g.font = '600 38px Arial, sans-serif'; g.fillText('Payment successful', 360, 290);
    g.fillStyle = '#111'; g.font = '700 110px Arial, sans-serif'; g.fillText('₹' + Number(o.amount).toLocaleString('en-IN'), 360, 430);
    g.textAlign = 'left'; g.fillStyle = '#555'; g.font = '30px Arial, sans-serif';
    var d = new Date(o.at), t = d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var rows = [['Paid to', 'Sample Events Team'], ['UPI ID', o.upi || 'sample.events@demobank'], ['From', o.name], ['Date', t], ['UPI Ref No', o.ref]];
    rows.forEach(function (r, i) { var y = 620 + i * 100; g.fillStyle = '#777'; g.font = '26px Arial, sans-serif'; g.fillText(r[0], 60, y); g.fillStyle = '#111'; g.font = '600 32px Arial, sans-serif'; g.fillText(r[1], 60, y + 40); });
    g.fillStyle = '#999'; g.font = '22px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('Sample screenshot for the demo', 360, 1200);
    return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.92); });
  }

  // ---- the database ------------------------------------------------------------------------------------------------------
  var backend = null, readyP = null;
  function open() {
    if (readyP) return readyP;
    readyP = (async function () {
      progress(0.01, 'Loading the database engine');
      var pg = await import(BASE + 'pglite/worker/index.js');
      var core = await import(BASE + 'core.js'), seedMod = await import(BASE + 'seed.js');
      var parts = await (await fetch(BASE + 'schema.json')).json();
      var w = new Worker(BASE + 'db-worker.js', { type: 'module' });
      var db = new pg.PGliteWorker(w, { dataDir: 'idb://' + DB_NAME });
      try {
        backend = await core.Backend.open({
          db: db, parts: parts, progress: progress,
          seed: function (be, pr) { return seedMod.seed(be, pr, { putShot: function (path, o) { return drawShot(o).then(function (b) { return fput('payment-proofs/' + path, b); }); } }); }
        });
      } catch (e) {
        if (e && e.stale) { await resetStorage(); location.reload(); return new Promise(function () {}); }
        throw e;
      }
      backend.USERS = core.USERS;
      hideOverlay();
      return backend;
    })();
    readyP.catch(function (e) {
      console.error('[demo]', e);
      if (ov) ov.innerHTML = '<div style="max-width:340px"><div style="font-weight:700;font-size:18px;margin-bottom:8px">The demo could not start</div><div style="opacity:.75;margin-bottom:14px">' + String(e && e.message || e).replace(/</g, '&lt;') + '</div><button onclick="DemoBackend.reset()" style="font:inherit;padding:10px 16px;border-radius:10px;border:0;background:#1f7a5a;color:#fff">Reset the demo</button></div>';
    });
    return readyP;
  }
  function deleteDb(name) { return new Promise(function (res) { var r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); }
  async function resetStorage() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    await deleteDb('/pglite/' + DB_NAME); await deleteDb(FILES);
  }

  // ---- stand-in for the Supabase client ----------------------------------------------------------------------------
  function session() { try { var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return s && s.user ? s : null; } catch (e) { return null; } }
  function visitorIp() { try { var v = localStorage.getItem('ehsaas_demo_ip'); if (!v) { v = '203.0.113.' + (30 + Math.floor(Math.random() * 200)); localStorage.setItem('ehsaas_demo_ip', v); } return v; } catch (e) { return '203.0.113.99'; } }
  function ctx(anonOnly) { var s = anonOnly ? null : session(); return s ? { role: 'authenticated', uid: s.user.id, ip: '198.51.100.10' } : { role: 'anon', ip: visitorIp() }; }
  function mkSession(u) { return { access_token: 'demo', token_type: 'bearer', user: { id: u.id, email: u.email } }; }

  function createClient(url, key, opts) {
    var anonOnly = !!(opts && opts.auth && opts.auth.persistSession === false);   // the public page never keeps a login
    return {
      auth: {
        getSession: async function () { return { data: { session: anonOnly ? null : session() }, error: null }; },
        signInWithPassword: async function (c) {
          var be = await open(), list = Object.keys(be.USERS).map(function (k) { return be.USERS[k]; });
          var u = list.filter(function (x) { return x.email === String(c.email || '').trim().toLowerCase() && x.password === c.password; })[0];
          if (!u) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400 } };
          var s = mkSession(u); try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
          return { data: { session: s, user: s.user }, error: null };
        },
        signOut: async function () { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} return { error: null }; },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
      },
      rpc: function (name, args) { return open().then(function (be) { return be.rpc(ctx(anonOnly), name, args || {}); }, function (e) { return { data: null, error: { message: String(e && e.message || e) } }; }); },
      from: function (table) {
        var chain = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'order', 'limit', 'single', 'maybeSingle'], calls = [], q = {};
        chain.forEach(function (m) { q[m] = function () { calls.push([m, [].slice.call(arguments)]); return q; }; });
        q.then = function (res, rej) {
          return open().then(function (be) { var b = be.from(ctx(anonOnly), table); calls.forEach(function (c) { b[c[0]].apply(b, c[1]); }); return b._run(); },
            function (e) { return { data: null, error: { message: String(e && e.message || e) } }; }).then(res, rej);
        };
        return q;
      },
      storage: {
        from: function (bucket) {
          return {
            upload: async function (path, blob, opts) {
              var be = await open(), key = bucket + '/' + path;
              if (!(opts && opts.upsert) && await fget(key)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
              await fput(key, blob); await be.registerObject(bucket, path);
              return { data: { path: path }, error: null };
            },
            createSignedUrl: async function (path) {
              var b = await fget(bucket + '/' + path);
              if (!b) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
              return { data: { signedUrl: URL.createObjectURL(b) }, error: null };
            }
          };
        }
      }
    };
  }


  // ---- a small "Demo" tab on the left edge of every page ----------------------------------------------------------------
  function addTab() {
    if (script.getAttribute('data-tab') === 'off' || document.getElementById('dm-tab')) return;
    var home = BASE.replace(/app\/demo\/$/, '');
    var d = document.createElement('div'); d.id = 'dm-tab';
    d.innerHTML = '<style>#dm-tab{position:fixed;left:0;top:42%;z-index:2147482000;font:600 11px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '#dm-tab button.t{all:unset;cursor:pointer;display:block;writing-mode:vertical-rl;transform:rotate(180deg);background:#1f7a5a;color:#fff;padding:12px 5px;border-radius:0 8px 8px 0;letter-spacing:.08em;opacity:.88;box-shadow:0 2px 8px rgba(0,0,0,.25)}' +
      '#dm-tab button.t:focus-visible{outline:2px solid #fff;outline-offset:-4px}' +
      '#dm-m{position:absolute;left:26px;top:-60px;width:210px;background:#fffdf8;color:#1c1b19;border:1px solid #d8d2c4;border-radius:12px;padding:12px;box-shadow:0 8px 28px rgba(0,0,0,.3);display:none;font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '#dm-m b{display:block;margin-bottom:4px}#dm-m p{margin:0 0 8px;opacity:.75}' +
      '#dm-m a,#dm-m button{all:unset;cursor:pointer;display:block;padding:8px 10px;border-radius:8px;background:#eee9dc;margin-top:6px;text-align:center;font-weight:600;color:#1c1b19}#dm-m button.rs{background:#fbe7e3;color:#8a2417}</style>' +
      '<button class="t" aria-label="Demo menu" aria-expanded="false">DEMO</button>' +
      '<div id="dm-m" role="dialog" aria-label="About this demo"><b>Demo copy</b><p>Sample data only. Everything stays in this browser.</p><a href="' + home + '">Back to the demo home</a><button class="rs" type="button">Reset the demo</button></div>';
    document.body.appendChild(d);
    var m = d.querySelector('#dm-m'), t = d.querySelector('button.t');
    t.addEventListener('click', function () { var o = m.style.display === 'block'; m.style.display = o ? 'none' : 'block'; t.setAttribute('aria-expanded', String(!o)); });
    d.querySelector('button.rs').addEventListener('click', function () { if (confirm('Reset the demo? Anything you added will be removed and the sample data comes back.')) window.DemoBackend.reset(); });
  }
  if (document.body) addTab(); else document.addEventListener('DOMContentLoaded', addTab);

  window.supabase = { createClient: createClient };
  window.DemoBackend = {
    ready: function () { return open(); },
    onProgress: function (f) { listeners.push(f); f(state.p, state.t); },
    reset: async function () { try { if (readyP) { var be = await readyP; await be.db.close(); } } catch (e) {} await resetStorage(); location.reload(); },
    signInAs: async function (who) { var be = await open(), u = be.USERS[who]; if (!u) return false; try { localStorage.setItem(SESSION_KEY, JSON.stringify(mkSession(u))); } catch (e) {} return true; },
    signOut: function () { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} },
    users: function () { return open().then(function (be) { return be.USERS; }); }
  };
  if (script.getAttribute('data-eager') !== 'off') open();
  // the page's own loader waits for these
  if (script.hasAttribute('onload')) { /* handled by the browser */ }
})();
