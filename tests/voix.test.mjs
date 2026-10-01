// La lecture vocale ne doit jamais interrompre une veille, et le texte lu doit
// être exactement celui que le board lirait lui-même.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { texteFiche, nomFichier, synthetiser, purgerAudio, argumentsMoteur } from '../src/voix.mjs';

const ARTICLE = {
  id: 'pmid:12345',
  titre: 'Once-weekly incretin co-agonist',
  titre_fr: 'Co-agoniste incrétine hebdomadaire',
  accroche: "L'HbA1c baisse de 0,6 point de plus",
  contexte: 'Un contexte',
  methode: 'Une méthode',
  resultats: 'Des résultats',
  conclusion: 'Une conclusion',
  pour_la_pratique: 'Pour la pratique',
  limites: 'Des limites',
  auteurs: 'Dupont A, Durand B, et al.',
  mots_cles: ['diabète', 'incrétines'],
};

test('le texte lu suit l’ordre des rubriques affichées', () => {
  const t = texteFiche(ARTICLE);
  const ordre = ['Co-agoniste', 'HbA1c', 'Contexte.', 'Méthode.', 'Résultats.', 'Conclusion.', 'Pour la pratique.', 'Limites.'];
  let pos = -1;
  for (const m of ordre) {
    const i = t.indexOf(m);
    assert.ok(i > pos, `« ${m} » est absent ou mal placé`);
    pos = i;
  }
});

test('les auteurs et les mots-clés ne sont pas lus', () => {
  // Ce sont des listes qu'on parcourt des yeux, pas de la prose qu'on écoute.
  const t = texteFiche(ARTICLE);
  assert.ok(!t.includes('Dupont'), 'les auteurs ne doivent pas être lus');
  assert.ok(!t.includes('incrétines'), 'les mots-clés ne doivent pas être lus');
});

test('le titre français prime sur le titre original', () => {
  assert.ok(texteFiche(ARTICLE).startsWith('Co-agoniste incrétine hebdomadaire.'));
  const sansFr = { ...ARTICLE, titre_fr: '' };
  assert.ok(texteFiche(sansFr).startsWith('Once-weekly incretin co-agonist.'));
});

test('chaque segment se termine par une ponctuation : sans elle, la voix enchaîne sans respirer', () => {
  const t = texteFiche({ id: 'x', titre_fr: 'Un titre', accroche: 'Une accroche' });
  assert.equal(t, 'Un titre. Une accroche.');
});

test('une rubrique vide ne laisse pas son intitulé tout seul', () => {
  const t = texteFiche({ id: 'x', titre_fr: 'Titre', contexte: '', methode: 'Une méthode' });
  assert.ok(!t.includes('Contexte'));
  assert.ok(t.includes('Méthode. Une méthode.'));
});

test('les points clés d’une recommandation sont lus comme une suite de phrases', () => {
  const t = texteFiche({ id: 'r', titre_court: 'Reco', points_cles: ['Premier point', 'Second point'] }, { type: 'reco' });
  assert.ok(t.includes('Points clés. Premier point. Second point.'));
});

test('un identifiant ne fait pas un nom de fichier tel quel', () => {
  assert.equal(nomFichier('pmid:12345'), 'pmid-12345.mp3');
  assert.equal(nomFichier('has:https://has-sante.fr/a/b'), 'has-https-has-sante.fr-a-b.mp3');
  assert.equal(nomFichier(''), 'fiche.mp3');
  assert.equal(nomFichier(undefined), 'fiche.mp3');
});

test('deux identifiants différents ne se retrouvent pas dans le même fichier', () => {
  assert.notEqual(nomFichier('pmid:1'), nomFichier('doi:1'));
});

/* ---------- la voix ne doit jamais faire échouer une veille ---------- */

const config = (voix) => ({ voix });
const uneFiche = () => [{ fiche: { ...ARTICLE }, type: 'article' }];

test('voix inactive : rien ne se passe, et rien ne casse', async () => {
  const f = uneFiche();
  const r = await synthetiser({ fiches: f, dossier: '/tmp/majordoc-inexistant', cheminRelatif: 'a', config: config({ actif: false }), log: () => {} });
  assert.deepEqual(r, { actif: false, faits: 0, echecs: 0, octets: 0 });
  assert.equal(f[0].fiche.audio, undefined, 'sans fichier, le board doit retomber sur la synthèse');
});

test('modèle absent : la veille continue, avec un message explicite', async () => {
  const lignes = [];
  const r = await synthetiser({
    fiches: uneFiche(), dossier: '/tmp/majordoc-inexistant', cheminRelatif: 'a',
    config: config({ actif: true, modele: '/introuvable/modele.onnx' }),
    log: (l) => lignes.push(l),
  });
  assert.equal(r.motif, 'modele');
  assert.equal(r.actif, false);
  assert.match(lignes.join(' '), /modèle introuvable/);
});

test('Piper introuvable : compté en échec, jamais jeté', async () => {
  const sortie = await mkdtemp(path.join(tmpdir(), 'majordoc-voix-'));
  const f = uneFiche();
  const lignes = [];
  const r = await synthetiser({
    fiches: f, dossier: sortie, cheminRelatif: 'a',
    // Le modèle doit exister pour arriver jusqu'à l'appel de la commande.
    config: config({ actif: true, modele: sortie, commande: '/introuvable/piper' }),
    log: (l) => lignes.push(l),
  });
  assert.equal(r.faits, 0);
  assert.equal(r.echecs, 1);
  assert.equal(f[0].fiche.audio, undefined);
  assert.match(lignes.join(' '), /introuvable/);
});

test('la purge emporte les journées trop anciennes, et elles seules', async () => {
  const racine = path.join(await mkdtemp(path.join(tmpdir(), 'majordoc-audio-')), 'audio');
  const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  for (const d of ['2020-01-01', '2020-06-15', hier, 'pas-une-date']) {
    await mkdir(path.join(racine, d), { recursive: true });
  }
  const r = await purgerAudio(racine, 7);
  assert.equal(r.supprimees, 2);
  const restant = (await readdir(racine)).sort();
  assert.deepEqual(restant, ['pas-une-date', hier].sort());
});

test('une rétention nulle ou absente ne supprime rien', async () => {
  const racine = path.join(await mkdtemp(path.join(tmpdir(), 'majordoc-audio-')), 'audio');
  await mkdir(path.join(racine, '2020-01-01'), { recursive: true });
  assert.deepEqual(await purgerAudio(racine, 0), { supprimees: 0 });
  assert.deepEqual(await purgerAudio(racine, undefined), { supprimees: 0 });
  assert.deepEqual(await readdir(racine), ['2020-01-01']);
});

test('un dossier d’audio inexistant ne fait pas échouer la purge', async () => {
  assert.deepEqual(await purgerAudio('/introuvable/audio', 7), { supprimees: 0 });
});

/* ---------- le moteur doit pouvoir changer sans toucher au code ---------- */

test('par défaut, les arguments sont ceux de Piper', () => {
  assert.deepEqual(
    argumentsMoteur({}, '/voix/m.onnx', '/tmp/o.wav'),
    ['-m', '/voix/m.onnx', '-f', '/tmp/o.wav', '--sentence-silence', '0.35', '--length-scale', '1']
  );
});

test('un modèle multi-voix se choisit par son locuteur', () => {
  // fr_FR-mls-medium en contient 125 : c'est la façon la moins chère d'en essayer d'autres.
  const a = argumentsMoteur({ locuteur: 37 }, '/m.onnx', '/o.wav');
  assert.deepEqual(a.slice(-2), ['-s', '37']);
});

test('le locuteur zéro est un locuteur, pas une absence', () => {
  assert.ok(argumentsMoteur({ locuteur: 0 }, '/m.onnx', '/o.wav').includes('-s'));
  assert.ok(!argumentsMoteur({}, '/m.onnx', '/o.wav').includes('-s'));
});

test('la diction et le grain se règlent depuis le config', () => {
  const a = argumentsMoteur({ longueur: 1.15, noise_w: 0.9, noise: 0.6 }, '/m.onnx', '/o.wav');
  assert.deepEqual(a.slice(a.indexOf('--length-scale'), a.indexOf('--length-scale') + 2), ['--length-scale', '1.15']);
  assert.ok(a.includes('--noise-w-scale') && a.includes('0.9'));
  assert.ok(a.includes('--noise-scale') && a.includes('0.6'));
});

test('un autre moteur se branche par un gabarit d’arguments', () => {
  // Le jour où Piper ne suffit plus, le config doit suffire.
  assert.deepEqual(
    argumentsMoteur({ arguments: ['--model', '{modele}', '--output', '{sortie}', '--speaker', '{locuteur}'], locuteur: 'ff_siwis' },
      '/k/kokoro.onnx', '/tmp/o.wav'),
    ['--model', '/k/kokoro.onnx', '--output', '/tmp/o.wav', '--speaker', 'ff_siwis']
  );
});

test('un jeton sans valeur ne laisse pas d’argument vide derrière lui', () => {
  assert.deepEqual(
    argumentsMoteur({ arguments: ['--out', '{sortie}', '{locuteur}'] }, '/m.onnx', '/o.wav'),
    ['--out', '/o.wav']
  );
});
