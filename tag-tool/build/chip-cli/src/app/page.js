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

  /*
   * Another program reading the tags. On Dan's first run on Windows (screen recording, 26
   * October 2026) a program that starts with Windows, GoToTags, read each tag as it arrived
   * and typed its UID like a keyboard into whatever had the focus, over and over, byte
   * reversed and in hex pairs: "35 49 5E 6D 05 08 02 E0". It landed in the product code
   * box. The page now refuses typing like that and says what to do.
   */
  var ANOTHER_PROGRAM = 'Another program is reading the tags and typing their ID (usually GoToTags). Exit it from the icon near the clock (right click, Exit), or end it in Task Manager, then try again.';
  /** Longer than this is never typed by a person into the code box. The codes are two letters. */
  var MAX_TYPED = 6;
  /** Keys this close together (ms) were not pressed by a person (a held key's repeats are not counted)... */
  var FAST_KEY_MS = 30;
  /** ...once this many arrive in a row like that. */
  var FAST_RUN = 3;
  /** How long the banner stays up after the last ID typed in, when the Tag Tool itself has not seen the other program. */
  var ANOTHER_PROGRAM_SHOW_MS = 60000;

  var $ = function (id) { return document.getElementById(id); };
  var codes = [];
  var state = null;
  var lastNotice = null;
  var bannerTimer = null;
  var pollTimer = null;
  var typedIdAt = null;
  var typedIdTimer = null;
  var anotherProgramShown = false;
  var keyRun = { at: null, run: 0 };
  /** The code box's last value that was empty or a product code: what typing an ID into it goes back to. */
  var lastGoodCode = '';

  function plainTitle(code) { return PLAIN[code] || 'Something went wrong'; }

  /* ---------------------------------------------------------------- codes */

  function findCode(text) {
    var wanted = String(text || '').trim().toLowerCase();
    for (var i = 0; i < codes.length; i += 1) if (codes[i].code === wanted) return codes[i];
    return null;
  }

  /**
   * True for text no person types into the code box: an ID typed in by a keyboard wedge.
   * Anything longer than a code could be, two hex pairs with a space or colon between them,
   * or six hex digits in a row. A product code itself never counts.
   */
  function looksLikeTagId(text) {
    var t = String(text || '').trim();
    if (t === '' || findCode(t) !== null) return false;
    var longest = codes.reduce(function (n, c) { return Math.max(n, c.code.length); }, MAX_TYPED);
    return t.length > longest || /[0-9a-f]{2}[ :][0-9a-f]{2}/i.test(t) || /^[0-9a-f]{6,}$/i.test(t);
  }

  /**
   * The rhythm of the keys: how many have arrived in a row, each within FAST_KEY_MS of the
   * one before. `at` is the key event's timeStamp. Returns the length of the run so far.
   */
  function keyRhythm(run, at) {
    if (run.at !== null && at - run.at >= 0 && at - run.at <= FAST_KEY_MS) run.run += 1;
    else run.run = 1;
    run.at = at;
    return run.run;
  }

  /** Whether the "another program" banner shows: the Tag Tool saw it, or an ID was typed in recently. */
  function anotherProgramShowing(s, typedAt, now) {
    if (s && s.anotherProgram) return true;
    return typedAt !== null && now - typedAt < ANOTHER_PROGRAM_SHOW_MS;
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

  function desktopNotify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Tag Tool: ' + title, { body: body, tag: 'trevean-tag-tool', renotify: true });
      } catch (e) {
        /* Some browsers only allow notifications from a service worker. The banner is showing. */
      }
    }
  }

  function announce(notice) {
    // While the "another program" banner is up, an error is that program at work, and the
    // banner says what to do about it. A second red banner would only bury it.
    if (notice.kind === 'error' && anotherProgramShown) return;
    var banner = $('banner');
    banner.className = notice.kind;
    // An error notice is titled with its code; show the plain words for it when there are some.
    banner.querySelector('.title').textContent = notice.kind === 'error' && PLAIN[notice.title] ? PLAIN[notice.title] : notice.title;
    banner.querySelector('.body').textContent = notice.body;
    banner.style.display = 'block';
    clearTimeout(bannerTimer);
    if (notice.kind !== 'error') bannerTimer = setTimeout(function () { banner.style.display = 'none'; }, 8000);
    if (notice.kind === 'written' || notice.kind === 'error') beep(notice.kind);
    desktopNotify(banner.querySelector('.title').textContent, notice.body);
  }

  /** Shows or hides the "another program" banner, and says it out loud the moment it appears. */
  function renderAnotherProgram() {
    var showing = anotherProgramShowing(state, typedIdAt, performance.now());
    var box = $('another-program');
    box.style.display = showing ? 'block' : 'none';
    $('another-program-why').textContent = state && state.anotherProgram ? state.anotherProgram : (showing ? 'A tag\'s ID was typed into this page.' : '');
    if (showing && !anotherProgramShown) {
      $('banner').style.display = 'none';
      beep('error');
      desktopNotify('Another program is reading the tags', ANOTHER_PROGRAM);
    }
    anotherProgramShown = showing;
  }

  /** A tag's ID was typed in. Throw it away and say why. */
  function typedIdSeen() {
    var box = $('code');
    if (findCode(box.value) === null) box.value = lastGoodCode;
    // Nothing keeps the focus for it to type into.
    if (document.activeElement === box) box.blur();
    typedIdAt = performance.now();
    clearTimeout(typedIdTimer);
    typedIdTimer = setTimeout(renderAnotherProgram, ANOTHER_PROGRAM_SHOW_MS + 50);
    checkCode();
    render();
    renderAnotherProgram();
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

    // Another program is reading the tags: say that, not "not ready" or "cannot read".
    if (s.anotherProgram && (s.phase === 'tag-not-ready' || s.phase === 'error')) {
      return {
        reader: reader,
        title: 'Another program is reading the tags',
        detail: 'See the message at the top of the page. The Tag Tool keeps trying by itself, and carries on once that program has been closed.',
        uid: null,
        error: s.error,
      };
    }

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
      case 'tag-not-ready':
        // The reader sees a tag and lost it before it could be read. Not reader trouble.
        title = 'Tag not ready, retrying';
        detail = 'The reader sees a tag but lost it before it could be read. The Tag Tool keeps trying by itself. Keep the tag flat and still in the centre of the reader.';
        showError = true;
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
    if (s.phase === 'tag-not-ready') return 'Waiting for the tag to be ready.';
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
    renderAnotherProgram();
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
    globalThis.TagToolPage = {
      describe: describe,
      plainTitle: plainTitle,
      writeHint: writeHint,
      tagsNoun: tagsNoun,
      autoRefusal: autoRefusal,
      looksLikeTagId: looksLikeTagId,
      keyRhythm: keyRhythm,
      anotherProgramShowing: anotherProgramShowing,
      ANOTHER_PROGRAM: ANOTHER_PROGRAM,
      setCodes: function (list) { codes = list; },
    };
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

  /*
   * Every key, wherever the focus is, before anything else sees it. Keys arriving faster
   * than a person types are a keyboard wedge, and from the third in a row they are dropped.
   * A UID's first space is its third key and the Enter comes last, so a wedge can neither
   * tick the automatic box nor press Write with the space and Enter it types.
   */
  document.addEventListener('keydown', function (e) {
    if (e.repeat || typeof e.key !== 'string' || (e.key.length !== 1 && e.key !== 'Enter')) return;
    if (keyRhythm(keyRun, e.timeStamp) < FAST_RUN) return;
    e.preventDefault();
    e.stopPropagation();
    typedIdSeen();
  }, true);

  $('write').addEventListener('click', write);
  $('code').addEventListener('input', function () {
    var value = $('code').value;
    if (looksLikeTagId(value)) { typedIdSeen(); return; }
    if (value.trim() === '' || findCode(value) !== null) lastGoodCode = value;
    checkCode();
    showWriteError(null);
    render();
  });
  $('code').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !$('write').disabled) write(); });
  $('auto').addEventListener('change', function () { setAuto($('auto').checked); });
  $('notify').addEventListener('click', askNotify);
  Array.prototype.forEach.call(document.querySelectorAll('[data-sim]'), function (button) {
    button.addEventListener('click', function () { post('/api/sim', { action: button.getAttribute('data-sim') }).catch(showWriteError); });
  });

  notifyState();
  // The code box is not given the focus. A keyboard wedge types into whatever has it.
  loadCodes();
  connect();
})();
