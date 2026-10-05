import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { getPack } from '../content/hvylia/packs.js';

// Exercise the production classes against real SQLite. Only the Cloudflare base
// class is adapted for Node; SQL, transactions and ledger methods are unchanged.
const accountSource = (await readFile(new URL('../api/hvylia-accounts.js', import.meta.url), 'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }')
  .replace("'./hvylia-telegram.js'", JSON.stringify(new URL('../api/hvylia-telegram.js', import.meta.url).href))
  .replace("'../content/hvylia/packs.js'", JSON.stringify(new URL('../content/hvylia/packs.js', import.meta.url).href));
const { WaveAccountDO, WaveLeaderboardDO } = await import(`data:text/javascript;base64,${Buffer.from(accountSource).toString('base64')}`);
const TOKEN = '123456:local_test_bot_token';
const USER = { id: 10101010, first_name: 'Олена', last_name: 'Коваль' };

function storage(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return {
    sql: {
      exec(sql, ...args) {
        const rows = db.prepare(sql).all(...args);
        return {
          toArray: () => rows,
          one: () => { assert.equal(rows.length, 1); return rows[0]; }
        };
      }
    },
    transactionSync(callback) {
      db.exec('BEGIN');
      try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
}

function account(t, user = USER) {
  const instance = new WaveAccountDO({ storage: storage(t) }, { HVYLIA_BOT_TOKEN: TOKEN });
  if (user) instance.profile(user);
  return instance;
}

function fakeBot(t, handler) {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url, options) => new Response(JSON.stringify({ ok: true, result: await handler(url, JSON.parse(options.body)) }), { status: 200 });
}

function payment(purchase, overrides = {}) {
  return {
    from: USER,
    successful_payment: { currency: 'XTR', total_amount: 150, invoice_payload: `hvylia:v1:${purchase.purchaseId}`, telegram_payment_charge_id: `charge-${purchase.purchaseId}`, ...overrides }
  };
}

test('account profile needs a registered owner, uses an opaque public identity and updates signed names', t => {
  const instance = account(t, null);
  assert.throws(() => instance.profile(), error => error.code === 'ACCOUNT');
  const profile = instance.profile(USER);
  assert.match(profile.publicId, /^[a-f0-9-]{36}$/u);
  assert.equal(JSON.stringify(profile).includes(String(USER.id)), false);
  assert.deepEqual(profile.ownedPacks, []);
  assert.deepEqual(profile.stats, { wins: 0, losses: 0, played: 0, points: 0 });
  const renamed = instance.profile({ ...USER, first_name: 'Оленка' });
  assert.equal(renamed.name, 'Оленка Коваль');
  assert.equal(renamed.publicId, profile.publicId);
  assert.equal(renamed.revision, profile.revision + 1);
  assert.equal(instance.profile({ ...USER, first_name: 'Оленка' }).revision, renamed.revision);
  assert.throws(() => instance.profile({ ...USER, id: USER.id + 1 }), error => error.code === 'ACCOUNT');
});

test('nickname accounts keep opaque owners and receipt-based rankings without granting Telegram purchases', async t => {
  const first = account(t, null);
  const second = account(t, null);
  const guest = { id: '00000000-0000-4000-8000-000000000001', name: '  Хвиля   ' };
  const profile = first.guestProfile(guest);
  assert.equal(profile.kind, 'guest');
  assert.equal(profile.name, 'Хвиля');
  assert.equal(JSON.stringify(profile).includes(guest.id), false);
  const other = second.guestProfile({ ...guest, id: '00000000-0000-4000-8000-000000000002' });
  assert.notEqual(profile.publicId, other.publicId);
  assert.equal(profile.name, other.name);
  assert.throws(() => first.guestProfile({ ...guest, id: '00000000-0000-4000-8000-000000000003' }), error => error.code === 'ACCOUNT');
  assert.throws(() => first.profile(USER), error => error.code === 'ACCOUNT');
  assert.throws(() => second.guestProfile({ id: 'not-a-uuid', name: 'Нік' }), error => error.code === 'ACCOUNT');
  await assert.rejects(first.createInvoice('anime'), error => error.code === 'TELEGRAM_REQUIRED');
  const receipt = { matchId: 'guest-match', won: true, points: 12, packId: 'standard', finishedAt: Date.now(), name: 'Forged winner' };
  const result = first.recordMatch(receipt);
  assert.equal(result.name, 'Хвиля');
  assert.deepEqual(result.stats, { wins: 1, losses: 0, played: 1, points: 12 });
  assert.deepEqual(first.recordMatch(receipt), result);
  const renamed = first.guestProfile({ ...guest, name: 'Марко' });
  assert.equal(renamed.publicId, profile.publicId);
  assert.deepEqual(renamed.stats, result.stats);
  assert.equal(renamed.name, 'Марко');
  const leaderboard = new WaveLeaderboardDO({ storage: storage(t) }, {});
  leaderboard.update(renamed);
  assert.equal(leaderboard.list().entries[0].name, 'Марко');
  assert.equal(JSON.stringify(leaderboard.list()).includes(guest.id), false);
  assert.equal(first.preCheckout({ from: USER, currency: 'XTR', total_amount: 150, invoice_payload: 'hvylia:v1:00000000-0000-4000-8000-000000000001' }), false);
});

test('Stars invoices persist before Bot API I/O, use server pricing and reuse an unpaid invoice', async t => {
  const instance = account(t);
  let requests = 0;
  fakeBot(t, (_url, params) => {
    requests += 1;
    assert.equal(params.currency, 'XTR');
    assert.equal(params.provider_token, '');
    assert.deepEqual(params.prices, [{ label: getPack('anime').title, amount: getPack('anime').priceStars }]);
    assert.ok(params.description.startsWith(`${getPack('anime').count} оригінальних`));
    assert.equal(Object.hasOwn(params, 'subscription_period'), false);
    assert.equal(instance.preCheckout({ from: USER, invoice_payload: params.payload, currency: 'XTR', total_amount: 150 }), true);
    return 'https://t.me/$test-anime-invoice';
  });
  const invoice = await instance.createInvoice('anime');
  assert.equal(invoice.invoiceLink, 'https://t.me/$test-anime-invoice');
  assert.deepEqual(await instance.createInvoice('anime'), invoice);
  assert.equal(requests, 1);
  await assert.rejects(instance.createInvoice('unknown'), error => error.code === 'PACK');
});

test('pre-checkout rejects wrong owners, currency, amount and forged payload', async t => {
  const instance = account(t);
  fakeBot(t, () => 'https://t.me/$valid-invoice');
  const invoice = await instance.createInvoice('games');
  const valid = { from: USER, currency: 'XTR', total_amount: 150, invoice_payload: `hvylia:v1:${invoice.purchaseId}` };
  assert.equal(instance.preCheckout(valid), true);
  for (const overrides of [{ from: { id: USER.id + 1 } }, { currency: 'USD' }, { total_amount: 149 }, { total_amount: '150' }, { invoice_payload: 'hvylia:v1:00000000-0000-0000-0000-000000000000' }]) {
    assert.equal(instance.preCheckout({ ...valid, ...overrides }), false);
  }
});

test('concurrent invoice requests produce one Bot API request without blocking profile reads', async t => {
  const instance = account(t);
  let finish;
  let started;
  const active = new Promise(resolve => { started = resolve; });
  fakeBot(t, async () => {
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  const creating = instance.createInvoice('anime');
  await active;
  assert.equal(instance.profile().name, 'Олена Коваль');
  await assert.rejects(instance.createInvoice('anime'), error => error.code === 'INVOICE_PENDING');
  finish('https://t.me/$concurrent-invoice');
  assert.equal((await creating).invoiceLink, 'https://t.me/$concurrent-invoice');
});

test('successful payments unlock a permanent pack once and reject conflicting or reused charges', async t => {
  const instance = account(t);
  fakeBot(t, () => 'https://t.me/$valid-invoice');
  const anime = await instance.createInvoice('anime');
  const games = await instance.createInvoice('games');
  const original = payment(anime);
  for (const changed of [payment(anime, { currency: 'EUR' }), payment(anime, { total_amount: 151 }), { ...original, from: { id: USER.id + 1 } }]) {
    assert.throws(() => instance.successfulPayment(changed), error => ['PAYMENT', 'ACCOUNT'].includes(error.code));
    assert.deepEqual(instance.profile().ownedPacks, []);
  }
  const received = instance.successfulPayment(original);
  assert.equal(received.duplicate, false);
  assert.deepEqual(received.profile.ownedPacks, ['anime']);
  const repeated = instance.successfulPayment(original);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.profile.revision, received.profile.revision);
  assert.throws(() => instance.successfulPayment(payment(anime, { telegram_payment_charge_id: 'different-charge' })), error => error.code === 'PAYMENT');
  assert.throws(() => instance.successfulPayment(payment(games, { telegram_payment_charge_id: original.successful_payment.telegram_payment_charge_id })), error => error.code === 'PAYMENT');
  assert.deepEqual(instance.profile().ownedPacks, ['anime']);
  assert.equal(instance.preCheckout({ from: USER, currency: 'XTR', total_amount: 150, invoice_payload: `hvylia:v1:${anime.purchaseId}` }), false);
  await assert.rejects(instance.createInvoice('anime'), error => error.code === 'OWNED');
});

test('invoice failure leaves no entitlement and a retry can create a fresh invoice', async t => {
  const instance = account(t);
  fakeBot(t, () => { throw new Error('simulated Bot API outage'); });
  await assert.rejects(instance.createInvoice('anime'), error => error.code === 'TELEGRAM_UNAVAILABLE');
  assert.deepEqual(instance.profile().ownedPacks, []);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: 'https://t.me/$retry-invoice' }), { status: 200 });
  const invoice = await instance.createInvoice('anime');
  assert.equal(invoice.invoiceLink, 'https://t.me/$retry-invoice');
});

test('refunds validate the owner and amount, revoke access, and repeated payment delivery cannot regrant it', async t => {
  const instance = account(t);
  fakeBot(t, () => 'https://t.me/$valid-invoice');
  const invoice = await instance.createInvoice('anime');
  const original = payment(invoice);
  instance.successfulPayment(original);
  const message = {
    from: { id: 88888, is_bot: true }, chat: { id: USER.id, type: 'private' },
    refunded_payment: { ...original.successful_payment }
  };
  assert.throws(() => instance.handleRefundedPayment({ ...message, chat: { id: USER.id + 1, type: 'private' } }), error => error.code === 'PAYMENT');
  assert.throws(() => instance.handleRefundedPayment({ ...message, refunded_payment: { ...message.refunded_payment, total_amount: 149 } }), error => error.code === 'PAYMENT');
  assert.deepEqual(instance.profile().ownedPacks, ['anime']);
  const refunded = instance.handleRefundedPayment(message);
  assert.equal(refunded.duplicate, false);
  assert.deepEqual(refunded.profile.ownedPacks, []);
  assert.equal(instance.handleRefundedPayment(message).duplicate, true);
  assert.deepEqual(instance.successfulPayment(original).profile.ownedPacks, []);
});

test('secured refund RPC uses the recorded owner and charge and calls Bot API only once', async t => {
  const instance = account(t);
  let refundCalls = 0;
  fakeBot(t, (url, params) => {
    if (url.endsWith('/createInvoiceLink')) return 'https://t.me/$valid-invoice';
    assert.ok(url.endsWith('/refundStarPayment'));
    refundCalls += 1;
    assert.equal(params.user_id, USER.id);
    assert.ok(params.telegram_payment_charge_id.startsWith('charge-'));
    return true;
  });
  const invoice = await instance.createInvoice('games');
  instance.successfulPayment(payment(invoice));
  assert.equal((await instance.refund(invoice.purchaseId)).ok, true);
  assert.deepEqual(instance.profile().ownedPacks, []);
  assert.equal((await instance.refund(invoice.purchaseId)).duplicate, true);
  assert.equal(refundCalls, 1);
});

test('an uncertain refund retains access until the confirmed webhook and avoids concurrent retries', async t => {
  const instance = account(t);
  let refundCalls = 0;
  fakeBot(t, url => {
    if (url.endsWith('/createInvoiceLink')) return 'https://t.me/$valid-invoice';
    refundCalls += 1;
    throw new Error('response lost after refund request');
  });
  const invoice = await instance.createInvoice('anime');
  const original = payment(invoice);
  instance.successfulPayment(original);
  await assert.rejects(instance.refund(invoice.purchaseId), error => error.code === 'TELEGRAM_UNAVAILABLE');
  assert.deepEqual(instance.profile().ownedPacks, ['anime']);
  assert.equal((await instance.refund(invoice.purchaseId)).pending, true);
  assert.equal(refundCalls, 1);
  const confirmed = instance.handleRefundedPayment({ from: USER, refunded_payment: original.successful_payment });
  assert.deepEqual(confirmed.profile.ownedPacks, []);
  assert.equal((await instance.refund(invoice.purchaseId)).duplicate, true);
  assert.equal(refundCalls, 1);
});

test('match receipts update wins and losses exactly once while preserving the signed account name', t => {
  const instance = account(t);
  const receipt = { matchId: 'match-one', won: true, points: 12, packId: 'standard', finishedAt: Date.now(), name: 'Someone else' };
  const first = instance.recordMatch(receipt);
  assert.deepEqual(first.stats, { wins: 1, losses: 0, played: 1, points: 12 });
  assert.equal(first.name, 'Олена Коваль');
  assert.deepEqual(instance.recordMatch({ ...receipt, won: false, points: 999 }), first);
  const second = instance.recordMatch({ ...receipt, matchId: 'match-two', won: false, points: 8 });
  assert.deepEqual(second.stats, { wins: 1, losses: 1, played: 2, points: 20 });
  for (const invalid of [{ ...receipt, matchId: '' }, { ...receipt, points: -1 }, { ...receipt, won: 1 }, { ...receipt, packId: 'unknown' }]) {
    assert.throws(() => instance.recordMatch(invalid), error => error.code === 'MATCH');
  }
  assert.deepEqual(instance.profile().stats, second.stats);
});

test('refunding one charge keeps a pack owned when another paid purchase still grants it', async t => {
  const instance = account(t);
  fakeBot(t, () => 'https://t.me/$valid-invoice');
  const invoice = await instance.createInvoice('anime');
  const original = payment(invoice);
  instance.successfulPayment(original);
  const otherId = '00000000-0000-4000-8000-000000000001';
  // A separate confirmed charge can exist after a delayed earlier checkout.
  instance.ctx.storage.sql.exec("INSERT INTO purchases (id, pack_id, amount, currency, status, created_at, charge_id) VALUES (?, ?, ?, ?, ?, ?, ?)", otherId, 'anime', 150, 'XTR', 'paid', Date.now(), 'other-confirmed-charge');
  const refunded = instance.handleRefundedPayment({ from: USER, refunded_payment: original.successful_payment });
  assert.deepEqual(refunded.profile.ownedPacks, ['anime']);
  const last = instance.handleRefundedPayment({ from: USER, refunded_payment: { ...original.successful_payment, invoice_payload: `hvylia:v1:${otherId}`, telegram_payment_charge_id: 'other-confirmed-charge' } });
  assert.deepEqual(last.profile.ownedPacks, []);
});

test('global rankings use committed revisions, ignore out-of-order updates and expose no Telegram identity', t => {
  const leaderboard = new WaveLeaderboardDO({ storage: storage(t) }, {});
  const first = account(t);
  const second = account(t, { ...USER, id: USER.id + 1, first_name: 'Марко' });
  const fresh = first.recordMatch({ matchId: 'one', won: true, points: 12, packId: 'standard', finishedAt: Date.now() });
  assert.deepEqual(leaderboard.update(fresh), { updated: true });
  assert.deepEqual(leaderboard.update(fresh), { updated: false });
  assert.deepEqual(leaderboard.update({ ...fresh, revision: fresh.revision - 1, stats: { wins: 0, losses: 0, played: 0, points: 0 } }), { updated: false });
  const other = second.recordMatch({ matchId: 'two', won: true, points: 16, packId: 'games', finishedAt: Date.now() });
  leaderboard.update(other);
  const list = leaderboard.list();
  assert.equal(list.entries.length, 2);
  assert.deepEqual(list.entries.map(row => row.publicId), [other.publicId, fresh.publicId]);
  assert.deepEqual(list.entries.map(row => row.rank), [1, 2]);
  assert.ok(list.updatedAt > 0);
  assert.equal(JSON.stringify(list).includes(String(USER.id)), false);
  assert.equal(Object.hasOwn(list.entries[0], 'ownedPacks'), false);
  assert.equal(leaderboard.list(1).entries.length, 1);
  assert.throws(() => leaderboard.update({ ...other, stats: { wins: 99, losses: 0, played: 1, points: 0 } }), error => error.code === 'RANKING');
});
