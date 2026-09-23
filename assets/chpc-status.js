// Lengau (CHPC) status card: reads the poller's live record from the
// chpc-status repo and draws the current state plus today's timeline (SAST).
(function () {
  var box = document.getElementById('chpc-status');
  if (!box) return;

  var RECORD_URL = 'https://nicolettechang.github.io/chpc-status/data/lengau_observations.csv';
  var REFRESH_MS = 5 * 60 * 1000;
  var STALE_MS = 30 * 60 * 1000;           // poller runs every 10 min
  var SAST_MS = 2 * 3600 * 1000;           // Africa/Johannesburg, no DST
  var DAY_MS = 86400000;

  var LABEL = {
    up: 'Reachable',
    down: 'Service disruption',
    unreachable: 'Portal unreachable',
    gap: 'No data'
  };

  function $(sel) { return box.querySelector(sel); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(t) { var d = new Date(t + SAST_MS); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function dur(ms) {
    var m = Math.round(ms / 60000), h = Math.floor(m / 60);
    return h ? h + 'h ' + pad(m % 60) + 'm' : m + 'm';
  }

  // The poller's CSV has one quoted field at most (note), never embedded newlines.
  function parse(text) {
    var lines = text.trim().split('\n'), head = lines.shift().split(',');
    var iT = head.indexOf('observed_at_utc'), iS = head.indexOf('status');
    return lines.map(function (l) {
      var f = l.split(',');
      return { t: Date.parse(f[iT]), status: f[iS] };
    }).filter(function (o) { return !isNaN(o.t) && LABEL[o.status]; });
  }

  function medianGap(obs) {
    var d = [];
    for (var i = 1; i < obs.length; i++) d.push(obs[i].t - obs[i - 1].t);
    d.sort(function (a, b) { return a - b; });
    return d.length ? d[Math.floor(d.length / 2)] : 10 * 60000;
  }

  // Same model as the dashboard: a change between polls sits at their
  // midpoint, and a hole longer than 3x the usual cadence is left as a gap.
  function segments(obs, gapMs) {
    var segs = [], prev = null;
    obs.forEach(function (o) {
      var last = segs[segs.length - 1];
      if (prev && o.t - prev.t > gapMs) {
        last.end = prev.t;
        segs.push({ status: 'gap', start: prev.t, end: o.t });
        segs.push({ status: o.status, start: o.t, end: o.t });
      } else if (last && last.status === o.status) {
        last.end = o.t;
      } else if (last) {
        var mid = (last.end + o.t) / 2;
        last.end = mid;
        segs.push({ status: o.status, start: mid, end: o.t });
      } else {
        segs.push({ status: o.status, start: o.t, end: o.t });
      }
      prev = o;
    });
    return segs;
  }

  function render(obs) {
    var now = Date.now();
    var dayStart = Math.floor((now + SAST_MS) / DAY_MS) * DAY_MS - SAST_MS;
    var dayEnd = dayStart + DAY_MS;
    var latest = obs[obs.length - 1];
    var stale = !latest || now - latest.t > STALE_MS;
    var state = stale ? 'gap' : latest.status;

    box.setAttribute('data-state', state);
    $('.chpc-state').textContent = stale ? 'Status unknown' : LABEL[state];
    $('.chpc-checked').textContent = latest
      ? 'last checked ' + hhmm(latest.t) + ' SAST (' + dur(now - latest.t) + ' ago)'
      : 'no checks recorded yet';

    // Clip to today; the last reading holds until "now" unless it has gone stale.
    var segs = segments(obs, 3 * medianGap(obs));
    if (latest && !stale) segs[segs.length - 1].end = now;
    var track = $('.chpc-track');
    track.innerHTML = '';
    var up = 0, known = 0, outages = 0;
    segs.forEach(function (s) {
      var a = Math.max(s.start, dayStart), b = Math.min(s.end, now, dayEnd);
      if (b <= a) return;
      if (s.status !== 'gap') { known += b - a; if (s.status === 'up') up += b - a; }
      if (s.status === 'down') outages++;
      var seg = document.createElement('span');
      seg.className = 'chpc-seg is-' + s.status;
      seg.style.left = (100 * (a - dayStart) / DAY_MS) + '%';
      seg.style.width = (100 * (b - a) / DAY_MS) + '%';
      seg.title = LABEL[s.status] + ' · ' + hhmm(a) + '–' + hhmm(b) + ' (' + dur(b - a) + ')';
      track.appendChild(seg);
    });
    var marker = document.createElement('span');
    marker.className = 'chpc-now';
    marker.style.left = (100 * (now - dayStart) / DAY_MS) + '%';
    track.appendChild(marker);

    $('.chpc-summary').textContent = known
      ? (100 * up / known).toFixed(1) + '% reachable today · ' +
        (outages ? outages + ' disruption' + (outages > 1 ? 's' : '') : 'no disruptions') +
        ' · ' + dur(known) + ' measured'
      : 'No readings yet today.';
  }

  function load() {
    fetch(RECORD_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (text) { render(parse(text)); })
      .catch(function () {
        box.setAttribute('data-state', 'gap');
        $('.chpc-state').textContent = 'Status unavailable';
        $('.chpc-checked').textContent = 'could not load the record';
      });
  }

  load();
  setInterval(load, REFRESH_MS);
})();
