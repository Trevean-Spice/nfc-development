/*
 * The only client script in this application, and it does one thing: the three call media
 * upload, because the middle call is a PUT from the browser straight to S3 and a form post
 * cannot do that.
 *
 * Everything else in the admin is a form that posts and a page that reloads. No framework,
 * no bundler, no build step. A tool a marketing team has to be able to use on whatever
 * laptop they have should not have a JavaScript bundle between them and a text field.
 */

(function () {
  'use strict';

  var form = document.getElementById('upload-form');
  if (!form) return;
  var log = document.getElementById('upload-log');
  var csrf = form.getAttribute('data-csrf') || '';

  function say(message) {
    log.textContent += message + '\n';
  }

  function fail(message) {
    log.textContent += 'FAILED: ' + message + '\n';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    log.textContent = '';

    var fileInput = document.getElementById('file');
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      fail('Choose a file first.');
      return;
    }
    var kind = document.getElementById('kind').value;
    var alt = document.getElementById('alt').value;

    var ticket = null;

    say('1 of 3. Asking the API for a presigned upload URL.');
    fetch('/media/ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: csrf,
        filename: file.name,
        contentType: file.type,
        bytes: String(file.size),
        kind: kind,
        alt: alt
      })
    })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body && body.error ? body.error.code + ': ' + body.error.message : 'HTTP ' + response.status);
          return body;
        });
      })
      .then(function (body) {
        ticket = body;
        say('   media id ' + ticket.mediaId + ', URL expires ' + ticket.expiresAt);
        say('2 of 3. Uploading the file straight to S3. It does not pass through any application function.');
        return fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file });
      })
      .then(function (response) {
        if (!response.ok) throw new Error('S3 refused the upload with HTTP ' + response.status);
        say('   uploaded ' + file.size + ' bytes.');
        say('3 of 3. Marking it complete so derivative generation starts.');
        return fetch('/media/' + ticket.mediaId + '/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf, alt: alt })
        });
      })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body && body.error ? body.error.code + ': ' + body.error.message : 'HTTP ' + response.status);
          return body;
        });
      })
      .then(function (media) {
        say('Done. Status ' + media.status + '. Derivatives are asynchronous, so processing for a few seconds is normal rather than broken.');
        setTimeout(function () {
          window.location.reload();
        }, 1500);
      })
      .catch(function (err) {
        fail(err.message);
        say('Nothing was hidden here. If this is a local run there is no S3 to upload to, and that is what a failure at step 2 means.');
      });
  });
})();
