// node --test tools/check-public-safe.test.mjs
//
// Every sample value is built at run time, so this file holds no literal the
// scanner would flag in the public tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './check-public-safe.mjs';

const kinds = (text) => scanText(text).map((f) => f.kind);
const acct = '4'.repeat(6) + '7'.repeat(5) + '1';
const uuid = ['9f3c2a1b', '0d4e', '4f6a', '8b7c', '5e2d1f0a9b8c'].join('-');

test('a clean line passes', () => {
  assert.deepEqual(kinds('deploy into <TREVEAN_DEV_ACCOUNT_ID> with the guard set'), []);
});

test('an account id in an ARN, a bucket name and prose is found', () => {
  assert.deepEqual(kinds(`arn:aws:iam::${acct}:role/x`), ['aws-account-id']);
  assert.deepEqual(kinds(`trevean-tfstate-${acct}`), ['aws-account-id']);
  assert.deepEqual(kinds(`account ${acct}.`), ['aws-account-id']);
});

test('UUID tails, fractions, phone numbers and documentation dummies are not account ids', () => {
  assert.deepEqual(kinds(`id 5f1c1f7e-0000-4000-8000-${'0'.repeat(4)}${acct.slice(4)}`), []);
  assert.deepEqual(kinds(`"responseReceivedTime": 37872.${acct}`), []);
  assert.deepEqual(kinds(`tel:+${acct}`), []);
  assert.deepEqual(kinds(`account ${'1234567890'}12 and ${'0'.repeat(12)}`), []);
});

test('the other identifier kinds are found', () => {
  assert.deepEqual(kinds(`trevean-dev-tsn${acct.slice(6)}-Growers`), ['aws-account-fragment']);
  assert.deepEqual(kinds(`org o-${'ab12cd34ef'}`), ['aws-org-id']);
  assert.deepEqual(kinds(`${'aws'}-root@treveanspice.com`), ['root-email']);
  assert.deepEqual(kinds(`aws-root@example.com and editor@treveanspice.com`), []);
  assert.deepEqual(kinds(`"author": "Trevean <${'someone'}@${'pm'}.me>"`), ['personal-email']);
  assert.deepEqual(kinds(`mail ${'someone'}@${'gmail'}.com or <TREVEAN_OWNER_EMAIL>`), ['personal-email']);
  assert.deepEqual(kinds(`editor@example.com, ops@serenelabs.io, git@github.com`), []);
  assert.deepEqual(kinds(`pool us-east-1_${'Ab3dE5gH9'}`), ['cognito-pool-id']);
  assert.deepEqual(kinds(`arn:aws:acm:us-east-1:<TREVEAN_DEV_ACCOUNT_ID>:certificate/${uuid}`), ['acm-certificate']);
  assert.deepEqual(kinds(`the certificate ${uuid} is issued`), ['acm-certificate']);
  assert.deepEqual(kinds(`a request id ${uuid}`), []);
  assert.deepEqual(kinds(`https://d${'2x7k9q4m1p8w5'}.cloudfront.net/t/PS`), ['cloudfront-host']);
  assert.deepEqual(kinds('https://d111111abcdef8.cloudfront.net/t/PS'), []);
  assert.deepEqual(kinds(`distribution E${'2QWRUHAPOMQZL'}`), ['cloudfront-id']);
  assert.deepEqual(kinds('distribution EDFDVBD6EXAMPLE'), []);
});

test('export and sanctions wording is found anywhere', () => {
  assert.deepEqual(kinds(`an ${'OF'}AC question`), ['export-text']);
  assert.deepEqual(kinds(`${'sanc'}tions screening`), ['export-text']);
  assert.deepEqual(kinds('base64 blob ab+ofac04/itar'), []);
});

test('counsel wording passes in licence context and fails outside it', () => {
  assert.deepEqual(kinds('## The summary a lawyer needs\n\nEvery runtime licence, listed.'), []);
  assert.deepEqual(kinds(`ask ${'coun'}sel about the shipment`), ['counsel-text']);
});

test('legal wording near Persian Sunrise is found; provenance notes are not', () => {
  assert.deepEqual(kinds('Origin: Isfahan, Iran. The blend contains no Iranian ingredient.'), []);
  assert.deepEqual(
    kinds(`Persian Sunrise\nsaffron sourcing\nneeds a ${'compl'}iance review before import`),
    ['persian-sunrise-legal'],
  );
});
