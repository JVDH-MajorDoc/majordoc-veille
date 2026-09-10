// Le classement a été calibré sur un audit relu par une praticienne :
// ces tests fixent les règles que cet audit a établies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detecterTheme, typeEtude, scorer, classer, selectionner } from '../src/rank.mjs';

const THEMES = {
  Diabète: ['diabetes', 'metformin', 'hba1c', 'insulin'],
  Surrénale: ['adrenal', 'cortisol', 'cushing', 'adrenalectomy'],
  Autre: [],
};

const article = (o = {}) => ({
  titre: '', resume: '', types: [], journal: '', journalAbrege: '',
  sources: ['a'], poidsSource: 1, accesLibre: false, ...o,
});

test('le titre décide du thème, le résumé ne fait que départager', () => {
  // Le cas de l'audit du 13 août : un essai de surrénalectomie qui mentionne
  // le diabète en passant ne doit pas atterrir en diabétologie.
  const a = article({
    titre: 'Adrenalectomy for autonomous cortisol secretion',
    resume: 'Patients with diabetes and hba1c above target, insulin use, metformin therapy...',
  });
  assert.equal(detecterTheme(a, THEMES), 'Surrénale');
});

test('à titre muet, le résumé tranche', () => {
  const a = article({ titre: 'A randomised trial', resume: 'metformin and hba1c in type 2 diabetes' });
  assert.equal(detecterTheme(a, THEMES), 'Diabète');
});

test('un article étranger à la spécialité retombe sur « Autre »', () => {
  assert.equal(detecterTheme(article({ titre: 'Knee arthroplasty outcomes' }), THEMES), 'Autre');
});

test('les types d’étude sont reconnus par ordre de force', () => {
  assert.equal(typeEtude(article({ types: ['Practice Guideline'] })), 'Recommandation');
  assert.equal(typeEtude(article({ types: ['Meta-Analysis', 'Review'] })), 'Méta-analyse');
  assert.equal(typeEtude(article({ types: ['Systematic Review'] })), 'Revue systématique');
  assert.equal(typeEtude(article({ types: ['Randomized Controlled Trial'] })), 'Essai randomisé');
  assert.equal(typeEtude(article({ types: ['Editorial'] })), 'Éditorial');
  assert.equal(typeEtude(article({ types: [] })), 'Article original');
});

test('un titre qui ne nomme pas la spécialité est relégué, pas écarté', () => {
  const config = { themes: THEMES };
  const nomme = scorer(article({ titre: 'Metformin in older adults', resume: '' }), config);
  const muet = scorer(article({ titre: 'A trial of a drug', resume: '' }), config);
  assert.equal(nomme.details.sujetEnTitre, 0);
  assert.equal(muet.details.sujetEnTitre, -4);
  assert.ok(nomme.score > muet.score);
});

test('le recoupement entre requêtes est un signal, plafonné', () => {
  const config = { themes: THEMES };
  const une = scorer(article({ sources: ['a'] }), config).details.recoupement;
  const trois = scorer(article({ sources: ['a', 'b', 'c'] }), config).details.recoupement;
  const dix = scorer(article({ sources: Array.from({ length: 10 }, (_, i) => `s${i}`) }), config).details.recoupement;
  assert.equal(une, 0);
  assert.ok(trois > une);
  assert.equal(dix, trois + 0.8, 'le plafond est atteint au quatrième recoupement');
});

test('les clés de documentation des blocs de config ne sont pas prises pour des revues', () => {
  const config = {
    themes: THEMES,
    journaux_penalises: { _commentaire: 'ceci est une note', 'Cureus': -3 },
    titres_penalises: { _commentaire: 'note', 'phase (i|1) ': -3 },
  };
  const neutre = scorer(article({ titre: 'Metformin trial', journal: 'Diabetes Care' }), config);
  assert.equal(neutre.details.journal, 0);
  assert.equal(neutre.details.titrePenalise, 0);
  const penalise = scorer(article({ titre: 'A phase 1 study of metformin', journal: 'Cureus' }), config);
  assert.equal(penalise.details.journal, -3);
  assert.equal(penalise.details.titrePenalise, -3);
});

test('un motif de titre mal formé n’interrompt pas la veille', () => {
  const config = { themes: THEMES, titres_penalises: { '([unclosed': -3 } };
  assert.doesNotThrow(() => scorer(article({ titre: 'Metformin' }), config));
});

test('classer trie par score décroissant et enrichit chaque article', () => {
  const config = { themes: THEMES, types_prioritaires: { 'meta-analysis': 4 } };
  const [premier, second] = classer([
    article({ titre: 'Insulin in hospital', types: [] }),
    article({ titre: 'Metformin: a meta-analysis', types: ['Meta-Analysis'] }),
  ], config);
  assert.match(premier.titre, /Metformin/);
  assert.equal(premier.typeEtude, 'Méta-analyse');
  assert.equal(premier.theme, 'Diabète');
  assert.ok(premier.score > second.score);
  assert.ok(premier.scoreDetails);
});

test('la sélection tient les quotas par thème et par revue', () => {
  const classes = [
    { theme: 'Diabète', journalAbrege: 'Diabetes Care', titre: 'd1' },
    { theme: 'Diabète', journalAbrege: 'Diabetes Care', titre: 'd2' },
    { theme: 'Diabète', journalAbrege: 'Diabetes Care', titre: 'd3' }, // 3e de la revue : écarté
    { theme: 'Diabète', journalAbrege: 'Diabetologia', titre: 'd4' },
    { theme: 'Diabète', journalAbrege: 'Diabetologia', titre: 'd5' },  // 5e du thème : écarté
    { theme: 'Surrénale', journalAbrege: 'JCEM', titre: 's1' },
  ];
  const retenus = selectionner(classes, { max: 4, maxParTheme: 3, maxParRevue: 2 });
  assert.deepEqual(retenus.map((a) => a.titre), ['d1', 'd2', 'd4', 's1']);
});

test('si les quotas laissent court, une seconde passe complète jusqu’au maximum', () => {
  const classes = [
    { theme: 'Diabète', journalAbrege: 'Diabetes Care', titre: 'd1' },
    { theme: 'Diabète', journalAbrege: 'Diabetes Care', titre: 'd2' },
    { theme: 'Diabète', journalAbrege: 'Diabetes Care', titre: 'd3' },
  ];
  const retenus = selectionner(classes, { max: 3, maxParTheme: 1, maxParRevue: 1 });
  assert.equal(retenus.length, 3, 'le board ne se retrouve pas à moitié vide');
  assert.deepEqual(retenus.map((a) => a.titre), ['d1', 'd2', 'd3']);
});
