// Holds the demo database for every open tab (one tab leads, the others talk to it), so a registration made in one tab
// is seen at once in another.
import { PGlite } from './pglite/index.js';
import { worker } from './pglite/worker/index.js';
worker({
  async init(options) {
    try { const d = new PGlite(options.dataDir, { relaxedDurability: true }); await d.waitReady; return d; }
    catch (e) { console.warn('[demo] browser storage is not available, using a temporary copy', e); return new PGlite('memory://demo'); }   // private windows may block storage
  }
});
// a temporary database file that is already gone when the background save looks for it: harmless, so it is not shown as an error
self.addEventListener('unhandledrejection', e => { const r = e.reason || {}; if (r && r.name === 'ErrnoError' && r.errno === 44) e.preventDefault(); });
