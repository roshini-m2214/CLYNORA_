// js/realtime.js  -  hand this to the frontend teammate
//
// Makes the dashboard update when the backend saves a new ESP32 reading.
// Add to index.html AFTER app.js:   <script src="js/realtime.js"></script>
//
// Then call it in two places in app.js:
//   1. right after loadSupabasePatients() succeeds (login, and session restore):  startVitalsRealtime();
//   2. at the top of logout():                                                    stopVitalsRealtime();
//
// IMPORTANT: this does NOT call pushVital(). pushVital() inserts into Supabase,
// so using it here would write every reading a second time.

(function () {
  let channel = null;
  let lastDraw = 0;
  let trailing = null;
  const MIN_REDRAW_MS = 8000;
  const LIVE_VIEWS = ['ov', 'dt_detail', 'dt_triage', 'n_triage', 'p_vitals', 'a_status', 'a_readings'];

  function safeRedraw() {
    if (typeof U === 'undefined' || !U || typeof draw !== 'function') return;
    if (!LIVE_VIEWS.includes(view)) return;
    const modal = document.getElementById('md');
    if (modal && modal.classList.contains('on')) return;           // don't disturb an open form
    const el = document.activeElement;
    if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    const y = window.scrollY;
    draw();                                                        // draw() scrolls to top...
    window.scrollTo(0, y);                                         // ...so put the user back
    lastDraw = Date.now();
  }

  // state.js already calls updateLiveVitalsDOM() if it exists, but nothing defines it yet.
  // Throttled so a reading every 5s doesn't re-render constantly.
  // Better long-term: replace this with a targeted DOM update of just the numbers
  // (a full draw() also restarts the ECG sweep animation).
  window.updateLiveVitalsDOM = function () {
    const wait = MIN_REDRAW_MS - (Date.now() - lastDraw);
    if (wait <= 0) return safeRedraw();
    if (!trailing) trailing = setTimeout(() => { trailing = null; safeRedraw(); }, wait);
  };

  function onNewVital(row) {
    const pid = Number(row.patient_id);
    const t = Number(row.recorded_at_ms);
    if (!S.v[pid]) S.v[pid] = [];

    // Skip rows this browser already has (its own inserts echo back through Realtime)
    if (S.v[pid].some(v => v.dbId === row.id || (v.k === row.vital_type && v.t === t))) return;

    S.v[pid].push({ dbId: row.id, t, k: row.vital_type, v: Number(row.value), s: row.source || 'device' });
    if (S.v[pid].length > 1000) S.v[pid].shift();

    const patient = getPatient(pid);
    if (patient) evaluatePatient(patient);        // raises the early-warning alert if thresholds crossed
    window.updateLiveVitalsDOM();
  }

  window.startVitalsRealtime = function () {
    const sb = window.supabaseClient;
    if (!sb || channel) return;
    channel = sb
      .channel('clynora-vitals-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vitals' },
          payload => onNewVital(payload.new))
      .subscribe(status => console.log('Realtime vitals:', status));
  };

  window.stopVitalsRealtime = function () {
    if (channel && window.supabaseClient) window.supabaseClient.removeChannel(channel);
    channel = null;
  };
})();
