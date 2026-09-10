// Contrôle des chiffres — le filet qui signale un nombre absent du résumé source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifierChiffres, controler } from '../src/verif.mjs';

const fiche = (accroche) => ({ accroche });

test('un chiffre présent dans le résumé source ne déclenche rien', () => {
  const r = verifierChiffres(fiche('HbA1c abaissée de 1,2 %'), 'HbA1c fell by 1.2% over 24 weeks');
  assert.equal(r.controles, 2);
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
