// Notification du matin — contenu, adresse, et surtout : ne jamais faire échouer la veille.
import test from 'node:test';
import assert from 'node:assert/strict';
import { messageEdito, cibleNtfy, notifierEdito } from '../src/notifier.mjs';

const edito = {
  titre: 'Diabète — la HAS rebat les cartes',
  points: ['La HAS actualise la stratégie du DT2.', 'Reprise pondérale à l’arrêt des GLP-1 (BMJ).'],
  a_lire_en_priorite: 'L’actualisation HAS',
};

test('le message reprend le titre, les points, la priorité et le décompte', () => {
  const m = messageEdito({ edito, nbArticles: 8, nbRecos: 2, url: 'https://veille.exemple.fr' });
  assert.equal(m.title, edito.titre);
  assert.match(m.message, /^• La HAS actualise/);
  assert.match(m.message, /À lire en priorité : L’actualisation HAS/);
  assert.match(m.message, /2 recommandations · 8 articles/);
  assert.equal(m.click, 'https://veille.exemple.fr');
});

test('sans édito, pas de notification', () => {
  assert.equal(messageEdito({ edito: null }), null);
  assert.equal(messageEdito({ edito: { points: [] } }), null);
});

test('un message trop long est tronqué', () => {
  const m = messageEdito({ edito: { titre: 'T', points: ['x'.repeat(3000)] } });
  assert.ok(m.message.length <= 1500);
  assert.ok(m.message.endsWith('…'));
});

test('l’adresse ntfy est séparée en serveur et sujet', () => {
  assert.deepEqual(cibleNtfy('https://ntfy.sh/majordoc-abc'), { serveur: 'https://ntfy.sh/', topic: 'majordoc-abc' });
  assert.deepEqual(cibleNtfy('https://ntfy.cabinet.fr:8443/veille/'), { serveur: 'https://ntfy.cabinet.fr:8443/', topic: 'veille' });
  assert.equal(cibleNtfy('https://ntfy.sh/'), null);
  assert.equal(cibleNtfy('pas une adresse'), null);
});

test('la notification part en JSON, accents compris', async (t) => {
  const avant = globalThis.fetch;
  let envoi;
  globalThis.fetch = async (url, init) => { envoi = { url, init }; return { ok: true, status: 200 }; };
  t.after(() => { globalThis.fetch = avant; });
  const r = await notifierEdito({ adresse: 'https://ntfy.sh/majordoc-abc', url: null, edito, nbArticles: 3, nbRecos: 0, log: () => {} });
  assert.equal(r.envoye, true);
  assert.equal(envoi.url, 'https://ntfy.sh/');
  const corps = JSON.parse(envoi.init.body);
  assert.equal(corps.topic, 'majordoc-abc');
  assert.equal(corps.title, edito.titre);
  assert.equal(corps.click, undefined);
});

test('une panne du serveur ntfy ne lève pas d’erreur', async (t) => {
  const avant = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  t.after(() => { globalThis.fetch = avant; });
  const r = await notifierEdito({ adresse: 'https://ntfy.sh/x', edito, log: () => {} });
  assert.equal(r.envoye, false);
});

test('sans NOTIF_NTFY, rien ne part', async () => {
  const r = await notifierEdito({ adresse: undefined, edito, log: () => {} });
  assert.equal(r.envoye, false);
});
