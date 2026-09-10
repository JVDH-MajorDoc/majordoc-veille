// Le registre empêche de payer deux fois le même article.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chargerRegistre, enregistrerRegistre, cleArticle, dejaVuArticle, marquerArticles, compter } from '../src/registre.mjs';

const racineTemporaire = () => mkdtemp(path.join(tmpdir(), 'majordoc-'));

test('la clé d’un article suit le PMID, puis le DOI, puis l’identifiant interne', () => {
  assert.equal(cleArticle({ pmid: '12345', doi: '10.1/AB' }), 'pmid:12345');
  assert.equal(cleArticle({ doi: '10.1/AB' }), 'doi:10.1/ab', 'le DOI est insensible à la casse');
  assert.equal(cleArticle({ id: 'interne-7' }), 'interne-7');
  assert.equal(cleArticle({ titre: 'Un titre sans identifiant' }), 'titre:Un titre sans identifiant');
});

test('un article marqué est reconnu, un autre ne l’est pas', () => {
  const registre = marquerArticles({ vus: {}, articles: {} }, [{ pmid: '1' }], '2026-09-01T06:00:00.000Z');
  assert.equal(dejaVuArticle(registre, { pmid: '1' }), true);
  assert.equal(dejaVuArticle(registre, { pmid: '2' }), false);
});

test('un registre absent se charge vide plutôt que d’échouer', async () => {
  const registre = await chargerRegistre(await racineTemporaire());
  assert.deepEqual(registre, { vus: {}, articles: {} });
});

test('un registre illisible se charge vide plutôt que d’interrompre la veille', async () => {
  const racine = await racineTemporaire();
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.join(racine, 'data'), { recursive: true });
  await writeFile(path.join(racine, 'data', 'deja-vus.json'), '{ ceci n’est pas du JSON');
  assert.deepEqual(await chargerRegistre(racine), { vus: {}, articles: {} });
});

test('ce qui est écrit se relit à l’identique', async () => {
  const racine = await racineTemporaire();
  const registre = marquerArticles({ vus: { 'reco:1': new Date().toISOString() }, articles: {} }, [{ pmid: '7' }]);
  await enregistrerRegistre(racine, registre);
  const relu = await chargerRegistre(racine);
  assert.equal(dejaVuArticle(relu, { pmid: '7' }), true);
  assert.deepEqual(compter(relu), { recos: 1, articles: 1 });
});

test('les entrées plus vieilles que la rétention sont purgées à l’écriture', async () => {
  const racine = await racineTemporaire();
  const vieux = new Date(Date.now() - 500 * 86400000).toISOString();
  const recent = new Date().toISOString();
  await enregistrerRegistre(racine, { vus: {}, articles: { 'pmid:vieux': vieux, 'pmid:recent': recent } });
  const relu = await chargerRegistre(racine);
  assert.deepEqual(Object.keys(relu.articles), ['pmid:recent']);
});

test('la rétention est paramétrable', async () => {
  const racine = await racineTemporaire();
  const hier = new Date(Date.now() - 2 * 86400000).toISOString();
  await enregistrerRegistre(racine, { vus: {}, articles: { 'pmid:1': hier } }, { retention: 1 });
  assert.deepEqual(Object.keys((await chargerRegistre(racine)).articles), []);
});

test('le fichier écrit est du JSON lisible à l’œil', async () => {
  const racine = await racineTemporaire();
  await enregistrerRegistre(racine, { vus: {}, articles: { 'pmid:1': new Date().toISOString() } });
  const brut = await readFile(path.join(racine, 'data', 'deja-vus.json'), 'utf8');
  assert.ok(brut.includes('\n  '), 'le registre est indenté, pour rester inspectable à la main');
});
