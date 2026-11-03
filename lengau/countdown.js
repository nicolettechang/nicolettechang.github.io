// Save your Lengau data, landing page: counts down to the deadlines in SAST and
// crosses days off the calendar. No network calls, no dependencies.
(function () {
  'use strict';

  var SAST_MS = 2 * 3600 * 1000;   // Africa/Johannesburg, no DST
  var DAY_MS = 86400000;

  // ---------- countdown ----------

  function renderCountdown() {
    var today = Math.floor((Date.now() + SAST_MS) / DAY_MS);
    var tiles = document.querySelectorAll('.lg-tile');
    for (var i = 0; i < tiles.length; i++) {
      var day = Math.floor(Date.parse(tiles[i].getAttribute('data-date') + 'T00:00:00Z') / DAY_MS);
      var left = day - today;
      var v = tiles[i].querySelector('.lg-tile-value');
      v.textContent = left > 1 ? left + ' days' : left === 1 ? 'tomorrow' : left === 0 ? 'today' : 'passed';
      tiles[i].classList.toggle('is-past', left < 0);
    }
    renderCalendar(today);
  }

  // ---------- calendar ----------

  // Sunday 25 October to Tuesday 1 December 2026. Days from the notice (29 October)
  // up to and including today are crossed off.
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var SVG = 'http://www.w3.org/2000/svg';

  function dayOf(iso) { return Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY_MS); }

  function crossMark() {
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'lg-cal-cross');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    [[6, 6, 94, 94], [94, 6, 6, 94]].forEach(function (p) {
      var l = document.createElementNS(SVG, 'line');
      l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]);
      l.setAttribute('x2', p[2]); l.setAttribute('y2', p[3]);
      l.setAttribute('stroke-width', '3');
      l.setAttribute('stroke-linecap', 'round');
      l.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(l);
    });
    return svg;
  }

  function renderCalendar(today) {
    var grid = document.getElementById('lg-cal-grid');
    if (!grid) return;
    var first = dayOf('2026-10-25'), noticed = dayOf('2026-10-29');
    var dataDue = dayOf('2026-11-27'), off = dayOf('2026-12-01');
    grid.textContent = '';
    for (var n = first; n <= off; n++) {
      var d = new Date(n * DAY_MS), month = d.getUTCMonth();
      var li = document.createElement('li');
      var tag = '', meaning = [];
      li.className = 'lg-cal-day';
      if (month !== 10) li.classList.add('is-other');
      if (n === dataDue) { li.classList.add('is-data'); tag = 'Data due'; meaning.push('all data moved off Lengau'); }
      if (n === off) { li.classList.add('is-off'); tag = 'Lengau off'; meaning.push('Lengau shuts down'); }
      if (n === today) { li.classList.add('is-today'); tag = tag ? 'Today · ' + tag : 'Today'; meaning.unshift('today'); }
      var crossed = n >= noticed && n <= today;
      if (crossed) { li.classList.add('is-crossed'); meaning.push('crossed off'); }

      var num = document.createElement('span');
      num.className = 'lg-cal-num';
      num.textContent = d.getUTCDate();
      // Short month shown once per month outside November (25 Oct, 1 Dec); the rest is for screen readers.
      var shown = month !== 10 && (n === first || d.getUTCDate() === 1);
      var full = document.createElement('span');
      full.className = shown ? 'lg-cal-month' : 'lg-sr';
      full.textContent = ' ' + (shown ? SHORT[month] : MONTHS[month]);
      num.appendChild(full);
      if (meaning.length) {
        var sr = document.createElement('span');
        sr.className = 'lg-sr';
        sr.textContent = ', ' + meaning.join(', ');
        num.appendChild(sr);
      }
      li.appendChild(num);
      if (tag) {
        var t = document.createElement('span');
        t.className = 'lg-cal-tag';
        t.setAttribute('aria-hidden', 'true');
        t.textContent = tag;
        li.appendChild(t);
      }
      if (crossed) li.appendChild(crossMark());
      grid.appendChild(li);
    }
  }

  renderCountdown();
  setInterval(renderCountdown, 60 * 60 * 1000);
})();
