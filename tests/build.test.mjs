// Les résumés d'origine voyagent à part : c'est ce qui empêche la recherche
// dans les archives de doubler de volume. Ces tests tiennent cette séparation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construire, fabriquerDigest, aplatir } from '../src/build.mjs';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

async function bati(digest, options = {}) {
  const sortie = path.join(await mkdtemp(path.join(tmpdir(), 'majordoc-site-')), 'site');
  await construire({ racine: RACINE, digest, sortie, ...options });
  return sortie;
}

const digestType = (extra = {}) => fabriquerDigest({
  config: { specialite: 'Test', themes: { A: ['a'] } },
  articles: [{ id: 'art:1', titre: 'Un titre', theme: 'A' }],
  date: '2026-09-11',
  sources: [],
  ...extra,
});

test('le résumé d’origine part dans un fichier voisin, jamais dans la journée', async () => {
  const sortie = await bati(digestType({ textesSource: { 'art:1': 'Original abstract here.' } }));
  const jour = JSON.parse(await readFile(path.join(sortie, 'data', '2026-09-11.json'), 'utf8'));

  assert.equal('textesSource' in jour, false, 'la journée ne doit pas porter les abstracts');
  assert.equal(jour.aSources, true, 'la journée doit signaler que ses sources existent');

  const sources = JSON.parse(await readFile(path.join(sortie, 'data', '2026-09-11-sources.json'), 'utf8'));
  assert.deepEqual(sources, { 'art:1': 'Original abstract here.' });
});

test('sans résumé d’origine, aucun fichier voisin et aucun drapeau', async () => {
  const sortie = await bati(digestType({ textesSource: {} }));
  const jour = JSON.parse(await readFile(path.join(sortie, 'data', '2026-09-11.json'), 'utf8'));
  assert.equal(jour.aSources, undefined, "pas de drapeau : le board n'affichera pas le dépliant");
  assert.equal(existsSync(path.join(sortie, 'data', '2026-09-11-sources.json')), false);
});

test('le fichier voisin n’est pas pris pour une journée dans l’index', async () => {
  const sortie = await bati(digestType({ textesSource: { 'art:1': 'abstract' } }));
  const index = JSON.parse(await readFile(path.join(sortie, 'data', 'index.json'), 'utf8'));
  assert.deepEqual(index.jours.map((j) => j.date), ['2026-09-11']);
});

test('la purge emporte le fichier voisin avec sa journée', async () => {
  const sortie = await bati(digestType({ textesSource: { 'art:1': 'abstract' } }));
  const data = path.join(sortie, 'data');
  // Une journée ancienne, avec son voisin, comme en production.
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, '2020-01-01.json'), JSON.stringify({ date: '2020-01-01', articles: [] }));
  await writeFile(path.join(data, '2020-01-01-sources.json'), JSON.stringify({ 'vieux:1': 'abstract' }));

  await construire({ racine: RACINE, digest: digestType({ textesSource: { 'art:1': 'abstract' } }), sortie, conservation: 30 });

  const restants = await readdir(data);
  assert.ok(!restants.includes('2020-01-01.json'), 'la journée ancienne doit être purgée');
  assert.ok(!restants.includes('2020-01-01-sources.json'), 'son fichier de sources aussi');
  assert.ok(restants.includes('2026-09-11-sources.json'), 'la journée du jour reste intacte');
});

test('le board autonome embarque ses résumés : il fonctionne sans réseau', async () => {
  const racineTmp = await mkdtemp(path.join(tmpdir(), 'majordoc-inline-'));
  await construire({
    racine: RACINE,
    digest: digestType({ textesSource: { 'art:1': 'Original abstract here.' } }),
    sortie: path.join(racineTmp, 'site'),
    inline: true,
  });
  // `construire` écrit board.html à la racine passée, pas dans la sortie.
  const fichier = path.join(RACINE, 'board.html');
  try {
    const html = await readFile(fichier, 'utf8');
    assert.ok(html.includes('Original abstract here.'), 'le résumé doit être inliné dans le fichier autonome');
  } finally {
    await rm(fichier, { force: true });   // le test ne laisse rien derrière lui
  }
});

test('aplatir transmet le rang de revue calculé par le classement', () => {
  const rang = { cle: 'reference', label: 'Revue de référence', poids: 5 };
  const [a] = aplatir([{ article: { id: '1', titre: 't', rangRevue: rang }, fiche: {} }]);
  assert.deepEqual(a.rangRevue, rang);
});

test('aplatir n’invente pas de rang quand le classement n’en a pas mis', () => {
  const [a] = aplatir([{ article: { id: '1', titre: 't' }, fiche: {} }]);
  assert.equal(a.rangRevue, null);
});
