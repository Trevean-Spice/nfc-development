/*
 * The Tag Tool page. Plain browser JavaScript, no libraries, no build step.
 *
 * The server owns the state. This page shows it, sends three kinds of request
 * (write, automatic on or off, and the simulator buttons), and turns the server's
 * notices into desktop notifications, with a banner on the page as well, which is
 * what is seen when notifications are off or refused.
 *
 * Everything from the server is put on the page as text, never as HTML.
 */
(function () {
  'use strict';

  var PLAIN = {
    TRANSPORT_UNAVAILABLE: 'The reader is not available',
    TAG_ABSENT: 'No tag found on the reader',
    TAG_NOT_ST25TV02KC: 'This is not the right kind of tag',
    TAG_CHANGED: 'The tag changed during the write',
    WRITE_FAILED: 'The write did not finish',
    READBACK_FAILED: 'The tag could not be read back',
    READBACK_MISMATCH: 'The tag does not hold what was written',
    AREA_PROTECTED: 'This tag is locked and cannot be written',
    CODE_UNKNOWN: 'That is not a product code',
    CODE_NOT_ENCODABLE: 'That product code cannot be written',
    TABLE_NOT_FOUND: 'The product table could not be found',
    TABLE_INVALID: 'The product table is not usable',
    JOURNAL_CORRUPT: 'The record of tags could not be saved',
    BUSY: 'Already writing',
    USAGE: 'The Tag Tool did something it should not',
  };

  var $ = function (id) { return document.getElementById(id); };
  var codes = [];
  var state = null;
  var lastNotice = null;
  var bannerTimer = null;
  var pollTimer = null;
  var codeTouched = false;

  function plainTitle(code) { return PLAIN[code] || 'Something went wrong'; }

  /* ---------------------------------------------------------------- codes */

  function findCode(text) {
    var wanted = String(text || '').trim().toLowerCase();
    for (var i = 0; i < codes.length; i += 1) if (codes[i].code === wanted) return codes[i];
    return null;
  }

  function encodableList() {
    return codes.filter(function (c) { return c.encodable; });
  }

  function checkCode() {
    var text = $('code').value.trim();
    var note = $('code-note');
    note.className = 'muted';
    if (text === '') { note.textContent = 'Type a code, or pick one from the list.'; return null; }
    var entry = findCode(text);
    if (entry === null) {
      note.className = 'bad';
      note.textContent = '"' + text + '" is not a product code. Use one of: ' + encodableList().map(function (c) { return c.code; }).join(', ') + '.';
      return null;
    }
    if (!entry.encodable) {
      note.className = 'bad';
      note.textContent = entry.code + ' (' + entry.blendName + ') is ' + entry.status + ' and cannot be written onto a tag.';
      return null;
    }
    note.textContent = entry.blendName + ', writes ' + entry.url;
    return entry;
  }

  function loadCodes() {
    return fetch('/api/codes', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (body) {
      codes = body.codes || [];
      var list = $('code-list');
      list.textContent = '';
      encodableList().forEach(function (c) {
        var option = document.createElement('option');
        option.value = c.code;
        option.label = c.code + '  ' + c.blendName;
        option.textContent = c.blendName;
        list.appendChild(option);
      });
      var help = encodableList().map(function (c) { return c.code + ' ' + c.blendName; }).join(', ');
      var refused = codes.filter(function (c) { return !c.encodable; }).map(function (c) { return c.code + ' (' + c.blendName + ')'; });
      $('codes-help').textContent = 'Codes: ' + help + '.' + (refused.length ? ' Not writable: ' + refused.join(', ') + '.' : '');
      checkCode();
      render();
    });
  }

  /* ---------------------------------------------------------- requests */

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var e = (data && data.error) || { code: 'HTTP_' + r.status, message: 'The Tag Tool refused the request.', remedy: 'Try again.' };
          throw e;
        }
        return data;
      });
    });
  }

  function showWriteError(e) {
    $('write-error').textContent = e ? plainTitle(e.code) + '. ' + e.message + ' ' + (e.remedy ? 'What to do: ' + e.remedy : '') : '';
  }

  function write() {
    var entry = checkCode();
    if (entry === null) { $('code').focus(); return; }
    showWriteError(null);
    $('write').disabled = true;
    post('/api/write', { code: entry.code }).catch(function (e) { showWriteError(e); render(); });
  }

  /**
   * Why automatic writing cannot be turned on with what is in the code field. A code
   * that exists but cannot be written (kg) is named as such, not called unknown.
   */
  function autoRefusal(text, entry) {
    if (entry && !entry.encodable) {
      return { code: 'CODE_NOT_ENCODABLE', message: entry.code + ' (' + entry.blendName + ') is ' + entry.status + ' and cannot be written onto a tag.', remedy: 'Choose a code that can be written, then tick the box.' };
    }
    if (String(text || '').trim() === '') {
      return { code: 'CODE_UNKNOWN', message: 'Choose the product code first.', remedy: 'Type or pick a code, then tick the box.' };
    }
    return { code: 'CODE_UNKNOWN', message: '"' + String(text).trim() + '" is not a product code.', remedy: 'Type or pick a code from the list, then tick the box.' };
  }

  function setAuto(enabled) {
    var entry = checkCode();
    if (enabled && entry === null) {
      $('auto').checked = false;
      showWriteError(autoRefusal($('code').value, findCode($('code').value)));
      return;
    }
    showWriteError(null);
    post('/api/auto', { enabled: enabled, code: entry ? entry.code : null }).catch(function (e) {
      $('auto').checked = false;
      showWriteError(e);
    });
  }

  /* ------------------------------------------------------- notifications */

  function notifyState() {
    var button = $('notify');
    var label = $('notify-state');
    if (!('Notification' in window)) {
      button.style.display = 'none';
      label.textContent = 'This browser has no desktop notifications. Messages show on this page.';
      return;
    }
    if (Notification.permission === 'granted') {
      button.style.display = 'none';
      label.textContent = 'Desktop notifications are on.';
    } else if (Notification.permission === 'denied') {
      button.style.display = 'none';
      label.textContent = 'Desktop notifications are blocked in this browser. Messages show on this page.';
    } else {
      button.style.display = '';
      label.textContent = '';
    }
  }

  function askNotify() {
    if (!('Notification' in window)) return;
    var asked = Notification.requestPermission(function () { notifyState(); });
    if (asked && typeof asked.then === 'function') asked.then(notifyState);
  }

  function beep(kind) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = beep.ctx || (beep.ctx = new Ctx());
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = kind === 'error' ? 220 : 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (kind === 'error' ? 0.45 : 0.15));
    } catch (e) {
      /* Sound is a nicety. */
    }
  }

  function announce(notice) {
    var banner = $('banner');
    banner.className = notice.kind;
    // An error notice is titled with its code; show the plain words for it when there are some.
    banner.querySelector('.title').textContent = notice.kind === 'error' && PLAIN[notice.title] ? PLAIN[notice.title] : notice.title;
    banner.querySelector('.body').textContent = notice.body;
    banner.style.display = 'block';
    clearTimeout(bannerTimer);
    if (notice.kind !== 'error') bannerTimer = setTimeout(function () { banner.style.display = 'none'; }, 8000);
    if (notice.kind === 'written' || notice.kind === 'error') beep(notice.kind);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Tag Tool: ' + banner.querySelector('.title').textContent, { body: notice.body, tag: 'trevean-tag-tool', renotify: true });
      } catch (e) {
        /* Some browsers only allow notifications from a service worker. The banner is showing. */
      }
    }
  }

  function handleNotices(notices) {
    if (!notices || notices.length === 0) return;
    var newest = notices[notices.length - 1].id;
    if (lastNotice === null) { lastNotice = newest; return; } // do not replay what happened before the page opened
    notices.forEach(function (n) { if (n.id > lastNotice) announce(n); });
    lastNotice = Math.max(lastNotice, newest);
  }

  /* --------------------------------------------------------------- render */

  function canWrite(s) {
    return s && (s.phase === 'tag-seen' || s.phase === 'written' || (s.phase === 'error' && s.uid !== null));
  }

  /**
   * What the status card says for a state, as plain words. Kept free of the page so
   * the tests and the text capture in the report use exactly these sentences.
   */
  function describe(s) {
    var title = '', detail = '', showError = false;
    var reader = s.readerName ? 'Reader ready: ' + s.readerName : (s.phase === 'starting' ? 'Reader: looking' : 'Reader: not found');
    var blend = s.code ? s.code + ' (' + s.blendName + ')' : '';
    var last = s.recent && s.recent.length ? s.recent[0] : null;
    var again = last && last.outcome === 'failed'
      ? 'This tag just failed. Press Write to try it again, or take it off and set it aside.'
      : 'This tag was just written. Put the next tag on, or press Write to write it again.';

    switch (s.phase) {
      case 'starting':
        title = 'Looking for the reader';
        detail = 'This can take up to ten seconds.';
        break;
      case 'reader-not-found':
        title = 'Reader not found';
        detail = 'The page keeps looking, and changes by itself when the reader is found.';
        showError = true;
        break;
      case 'waiting-for-tag':
        title = 'Waiting for a tag';
        detail = 'Put one tag flat on the reader.';
        break;
      case 'tag-seen':
        title = 'Tag seen';
        if (s.tagAlreadyAttempted) detail = again;
        else if (s.auto.enabled) detail = 'Writing ' + s.auto.code + ' automatically.';
        else detail = 'Choose the product code and press Write.';
        break;
      case 'writing':
        title = 'Writing ' + blend;
        detail = 'Keep the tag still on the reader.';
        break;
      case 'written':
        title = 'Written and verified';
        detail = blend + '. The tag reads back ' + s.url + '. Take it off and put the next tag on.';
        break;
      case 'error':
        // TAG_ABSENT with no UID is a tag the reader sees but cannot read, not a missing one.
        title = s.error && s.error.code === 'TAG_ABSENT' && !s.uid ? 'The reader cannot read the tag' : plainTitle(s.error && s.error.code);
        detail = s.uid ? 'Press Write to try this tag again, or take it off and set it aside.' : 'Take it off the reader.';
        showError = true;
        break;
    }
    return { reader: reader, title: title, detail: detail, uid: s.uid && s.phase !== 'waiting-for-tag' ? s.uid : null, error: showError ? s.error : null };
  }

  /** The line beside the Write button. With no reader there is no point asking for a tag. */
  function writeHint(s, writable) {
    if (s.phase === 'writing') return 'Writing...';
    if (s.phase === 'starting' || s.phase === 'reader-not-found') return 'Waiting for the reader.';
    if (!canWrite(s)) return 'Put a tag on the reader first.';
    return writable ? '' : 'Choose a product code.';
  }

  function tagsNoun(n) {
    return n === 1 ? 'tag' : 'tags';
  }

  function render() {
    var s = state;
    if (!s) return;
    var said = describe(s);
    var reader = said.reader, title = said.title, detail = said.detail, showError = said.error !== null;

    $('status').className = s.phase;
    $('reader-line').textContent = reader;
    $('status-title').textContent = title;
    $('status-detail').textContent = detail;
    if (said.uid) {
      var uid = document.createElement('div');
      uid.id = 'status-uid';
      uid.textContent = 'Tag UID ' + said.uid;
      $('status-detail').appendChild(document.createElement('br'));
      $('status-detail').appendChild(uid);
    }
    var box = $('status-error');
    box.style.display = showError && s.error ? 'block' : 'none';
    if (s.error) {
      $('error-code').textContent = s.error.code;
      $('error-plain').textContent = '';
      $('error-message').textContent = s.error.message;
      $('error-remedy').textContent = s.error.remedy;
    }

    document.title = title + ' | Tag Tool';
    $('sim-flag').style.display = s.isHardware ? 'none' : 'block';

    var autoBox = $('auto');
    autoBox.checked = s.auto.enabled;
    $('code').disabled = s.auto.enabled;
    if (s.auto.enabled && s.auto.code && $('code').value !== s.auto.code) { $('code').value = s.auto.code; checkCode(); }

    var entry = codes.length ? findCode($('code').value) : null;
    var writable = entry !== null && entry.encodable;
    $('write').disabled = !(canWrite(s) && writable);
    $('write-hint').textContent = writeHint(s, writable);

    if (s.simulator) {
      $('sim').style.display = 'block';
      $('sim-state').textContent = (s.simulator.readerConnected ? 'Reader plugged in' : 'Reader unplugged') + ', ' + (s.simulator.tagPresent ? 'a tag is on it.' : 'no tag on it.');
    } else {
      $('sim').style.display = 'none';
    }

    $('count').textContent = String(s.writtenCount);
    $('count-noun').textContent = tagsNoun(s.writtenCount);
    $('failed-count').textContent = s.failedAttempts ? ', ' + s.failedAttempts + ' failed attempt' + (s.failedAttempts === 1 ? '' : 's') : '';
    var body = $('recent');
    body.textContent = '';
    if (s.recent.length === 0) {
      var empty = document.createElement('tr');
      var cell = document.createElement('td');
      cell.colSpan = 4; cell.className = 'muted'; cell.textContent = 'Nothing written yet.';
      empty.appendChild(cell); body.appendChild(empty);
    }
    s.recent.forEach(function (u) {
      var tr = document.createElement('tr');
      var cells = [
        [new Date(u.at).toLocaleTimeString(), ''],
        [u.code + ' ' + u.blendName, ''],
        [u.uid || 'not reported', 'mono'],
        [u.outcome === 'verified' ? 'Verified, reads back ' + u.url : 'Failed: ' + (u.error ? u.error.code + ', ' + u.error.message.split('\n')[0] : ''), u.outcome === 'verified' ? 'ok' : 'fail'],
      ];
      cells.forEach(function (c) { var td = document.createElement('td'); td.textContent = c[0]; if (c[1]) td.className = c[1]; tr.appendChild(td); });
      body.appendChild(tr);
    });
    $('journals').textContent = s.journals.length ? s.journals.join(', ') : 'a file in the runs folder, once the first tag is written';
  }

  function receive(snapshot) {
    state = snapshot;
    $('connection').style.display = 'none';
    render();
    handleNotices(snapshot.notices);
  }

  /* --------------------------------------------------------------- wiring */

  // Outside a browser (the tests, the text capture) only the wording is wanted.
  if (typeof document === 'undefined') {
    globalThis.TagToolPage = { describe: describe, plainTitle: plainTitle, writeHint: writeHint, tagsNoun: tagsNoun, autoRefusal: autoRefusal };
    return;
  }

  function poll() {
    fetch('/api/state', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(receive).catch(function () {
      $('connection').style.display = 'block';
    });
  }

  function startPolling() {
    if (pollTimer === null) pollTimer = setInterval(poll, 1000);
  }

  function stopPolling() {
    if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connect() {
    if (!('EventSource' in window)) { startPolling(); return; }
    var source = new EventSource('/api/events');
    source.addEventListener('state', function (e) { stopPolling(); receive(JSON.parse(e.data)); });
    source.onopen = function () { stopPolling(); };
    source.onerror = function () { $('connection').style.display = 'block'; startPolling(); };
  }

  $('write').addEventListener('click', write);
  $('code').addEventListener('input', function () { codeTouched = true; checkCode(); showWriteError(null); render(); });
  $('code').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !$('write').disabled) write(); });
  $('auto').addEventListener('change', function () { setAuto($('auto').checked); });
  $('notify').addEventListener('click', askNotify);
  Array.prototype.forEach.call(document.querySelectorAll('[data-sim]'), function (button) {
    button.addEventListener('click', function () { post('/api/sim', { action: button.getAttribute('data-sim') }).catch(showWriteError); });
  });

  notifyState();
  loadCodes().then(function () { if (!codeTouched) $('code').focus(); });
  connect();
})();
