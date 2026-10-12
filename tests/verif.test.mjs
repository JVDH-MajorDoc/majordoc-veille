// Contrôle des chiffres — le filet qui signale un nombre absent du résumé source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifierChiffres, controler } from '../src/verif.mjs';

const fiche = (accroche) => ({ accroche });

test('un chiffre présent dans le résumé source ne déclenche rien', () => {
  const r = verifierChiffres(fiche('HbA1c abaissée de 1,2 %'), 'HbA1c fell by 1.2% over 24 weeks');
  assert.equal(r.controles, 1, 'le 1 de HbA1c fait partie du nom, il n’est pas contrôlé');
  assert.deepEqual(r.absents, []);
});

test('un chiffre absent du résumé source est signalé', () => {
  const r = verifierChiffres(fiche('réduction de 37 % du risque'), 'the risk was reduced by 21%');
  assert.deepEqual(r.absents, ['37']);
});

test('la virgule décimale française rejoint le point anglais', () => {
  const r = verifierChiffres(fiche('HR 0,931'), 'hazard ratio 0.931 (95% CI ...)');
  assert.deepEqual(r.absents, []);
});

test('le séparateur de milliers ne se confond pas avec une décimale', () => {
  // « 12,480 » en anglais = douze mille quatre cent quatre-vingts.
  const r = verifierChiffres(fiche('12 480 participants'), 'a total of 12,480 participants');
  assert.deepEqual(r.absents, []);
});

test('les millésimes ne sont pas contrôlés', () => {
  // Une fiche peut dater une recommandation sans que l'année figure dans le résumé.
  const r = verifierChiffres(fiche('recommandation 2024'), 'no year in this abstract');
  assert.equal(r.controles, 0);
  assert.deepEqual(r.absents, []);
});

test('le signe ne compte pas : le verbe le porte d’un côté, le nombre de l’autre', () => {
  const r = verifierChiffres(fiche('variation de −2,1 %'), 'HbA1c fell by 2.1%');
  assert.deepEqual(r.absents, []);
});

test('un pourcentage écrit en fraction concorde avec sa forme en pourcents', () => {
  const r = verifierChiffres(fiche('62 % des patients'), 'in 0.62 of participants');
  assert.deepEqual(r.absents, []);
});

test('une fiche sans aucun chiffre ne fait rien contrôler', () => {
  const r = verifierChiffres(fiche('aucun résultat chiffré rapporté'), 'no numbers either');
  assert.deepEqual(r, { controles: 0, absents: [] });
});

test('les champs propres aux recommandations sont bien ceux inspectés', () => {
  const reco = { ce_qui_change: 'seuil abaissé à 7,5 mmol/L', accroche: '' };
  assert.deepEqual(verifierChiffres(reco, 'threshold lowered to 7.5 mmol/L', { type: 'reco' }).absents, []);
  assert.deepEqual(verifierChiffres(reco, 'threshold lowered to 9 mmol/L', { type: 'reco' }).absents, ['7,5']);
});

test('controler pose la vérification sur chaque fiche et compte les signalées', () => {
  const resultats = [
    { fiche: { accroche: '1,2 %' }, article: { resume: 'fell by 1.2%' } },
    { fiche: { accroche: '37 %' }, article: { resume: 'reduced by 21%' } },
  ];
  const bilan = controler(resultats);
  assert.deepEqual(bilan, { total: 2, signalees: 1 });
  assert.deepEqual(resultats[0].fiche.verif.absents, []);
  assert.deepEqual(resultats[1].fiche.verif.absents, ['37']);
});

// Faux positifs relevés sur les fiches du 5 au 12 octobre 2026.
test('un nombre collé à des lettres fait partie d’un nom (IC95, Ki-67, I2, 25(OH)D)', () => {
  const r = verifierChiffres(fiche('OR 2,17 (IC95% 1,29-3,64 ; I2 48 %), Ki-67 30 %, 25(OH)D basse, NNC0385-0434'),
    'OR 2.17 (95% CI 1.29 to 3.64; I² = 48%), Ki-67 index 30%');
  assert.deepEqual(r.absents, []);
});

test('le point médian du Lancet et la décimale sans zéro sont des décimales', () => {
  assert.deepEqual(verifierChiffres(fiche('rapport 1,06 ; IC95% 0,56 à 2,01'), 'ratio 1·06 [95% CI 0·56 to 2·01]').absents, []);
  assert.deepEqual(verifierChiffres(fiche('β = -0,095 ; pFDR = 0,032'), '(β = -.095, pFDR = .032)').absents, []);
});

test('une plage d’années, une date et une énumération ne sont pas des résultats', () => {
  const r = verifierChiffres(fiche('registres 2006-2019, recherche au 22/09/2025 (09/2020-09/2025) ; (3) association précoce'), 'no such numbers');
  assert.equal(r.controles, 0);
});

test('« 6,07 M » concorde avec « 6,070,000 »', () => {
  const r = verifierChiffres(fiche('cas 6,07 M vers 3,995 M (2,23-14,29 M)'), 'from 6,070,000 to 3,995,000 (2,230,000-14,290,000)');
  assert.deepEqual(r.absents, []);
});

test('un effectif écrit en toutes lettres dans le résumé concorde', () => {
  assert.deepEqual(verifierChiffres(fiche('Seuls 2 essais, 8 femmes'), 'only two trials; eight women').absents, []);
  // Un chiffre vraiment ajouté reste signalé.
  assert.deepEqual(verifierChiffres(fiche('NNT voisin de 5'), 'only two trials').absents, ['5']);
});
