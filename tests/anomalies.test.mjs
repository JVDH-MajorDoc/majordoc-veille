// Sources qui se taisent — détection et rattrapage, à partir des journées publiées.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { volume, habituel, detecterChute, fenetreDeRattrapage, historique, RATTRAPAGE_MAX_JOURS } from '../src/anomalies.mjs';

const sources = (large, essais = 40, annales = 5) => [
  { source: 'pubmed-hautevaleur', label: 'PubMed — essais & méta-analyses', recus: essais, total: essais },
  { source: 'pubmed-large', label: 'PubMed — veille large', recus: large, total: large },
  { source: 'annales-endocrinologie', label: "Annales d'Endocrinologie (SFE)", recus: annales, total: annales },
];
const jour = (date, large) => ({ date, volume: volume(sources(large)), sources: sources(large) });
// Historique : du plus récent au plus ancien, comme le rend historique().
const normal = ['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28']
  .map((d, i) => jour(d, 1050 + i * 10));

test('le volume additionne les sources qui ont répondu', () => {
  assert.equal(volume(sources(1087)), 1132);
  assert.equal(volume([{ total: 10 }, { erreur: 'HTTP 503' }]), 10);
  assert.equal(volume([]), null);
});

test('un jour ordinaire ne déclenche rien', () => {
  assert.equal(detecterChute(sources(980), normal), null);
});

test('le 12 octobre (13 articles au lieu d’un millier) est une chute', () => {
  const c = detecterChute(sources(2, 6, 5), normal);
  assert.ok(c);
  assert.equal(c.volume, 13);
  assert.ok(c.habituel > 1000);
  assert.equal(c.parSource.find((s) => s.source === 'pubmed-large').total, 2);
});

test('sans historique suffisant, on ne crie pas au loup', () => {
  assert.equal(detecterChute(sources(2, 6, 5), []), null);
  assert.equal(detecterChute(sources(0, 0, 1), normal.map((h) => ({ ...h, volume: 20 }))), null);
});

test('les jours en chute ne tirent pas le volume habituel vers le bas', () => {
  const avecChutes = [jour('2026-10-07', 1), jour('2026-10-06', 2), jour('2026-10-05', 0), ...normal];
  assert.ok(habituel(avecChutes) > 1000);
});

test('pas de rattrapage quand la veille d’hier était normale', () => {
  assert.deepEqual(fenetreDeRattrapage(normal, { aujourdhui: '2026-10-05', fenetre: 4 }), { fenetre: 4, depuis: '2026-10-04' });
});

test('après trois jours pauvres, la fenêtre remonte jusqu’à la dernière journée normale', () => {
  const hist = [jour('2026-10-07', 1), jour('2026-10-06', 2), jour('2026-10-05', 0), ...normal];
  const r = fenetreDeRattrapage(hist, { aujourdhui: '2026-10-08', fenetre: 4 });
  assert.equal(r.depuis, '2026-10-04');
  assert.equal(r.fenetre, 8);   // quatre jours d'écart + la fenêtre habituelle
});

test('le rattrapage est borné', () => {
  const pauvres = Array.from({ length: 30 }, (_, i) => jour(`2026-09-${String(30 - i).padStart(2, '0')}`, 0));
  const hist = [...pauvres.slice(0, 5), ...normal.map((h) => ({ ...h, date: '2026-08-01' }))];
  const r = fenetreDeRattrapage(hist, { aujourdhui: '2026-10-12', fenetre: 4 });
  assert.equal(r.fenetre, RATTRAPAGE_MAX_JOURS);
});

test('l’historique lit les journées publiées, sans les fichiers sources ni la démo', async (t) => {
  const d = await mkdtemp(path.join(tmpdir(), 'majordoc-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  await writeFile(path.join(d, '2026-10-10.json'), JSON.stringify({ sources: sources(1000) }));
  await writeFile(path.join(d, '2026-10-11.json'), JSON.stringify({ sources: sources(900) }));
  await writeFile(path.join(d, '2026-10-11-sources.json'), JSON.stringify({}));
  await writeFile(path.join(d, '2026-10-09.json'), JSON.stringify({ demo: true, sources: sources(5) }));
  await writeFile(path.join(d, '2026-10-12.json'), JSON.stringify({ sources: sources(2) }));
  await writeFile(path.join(d, 'index.json'), '{}');
  const h = await historique(d, { avant: '2026-10-12' });
  assert.deepEqual(h.map((x) => x.date), ['2026-10-11', '2026-10-10']);
  assert.deepEqual(await historique(path.join(d, 'absent')), []);
});
