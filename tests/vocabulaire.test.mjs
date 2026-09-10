// Une seule liste sert à chercher et à classer : c'est ce que ces tests protègent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sujetDepuisThemes, preparerSources, themeOfficiel, TROP_GENERIQUES } from '../src/vocabulaire.mjs';

test('un radical simple se cherche tronqué, une expression entre guillemets', () => {
  const { sujet } = sujetDepuisThemes({ Thyroïde: ['thyroid', 'graves disease'] });
  assert.equal(sujet, '(TITLE_ABS:thyroid* OR TITLE_ABS:"graves disease")');
});

test('les termes trop génériques sont écartés de la recherche, pas du classement', () => {
  const { sujet, termes, ecartes } = sujetDepuisThemes({ 'Os & calcium': ['osteoporosis', 'calcium', 'fracture'] });
  assert.equal(termes, 1);
  assert.deepEqual(ecartes, ['calcium', 'fracture']);
  assert.ok(!sujet.includes('calcium'));
  assert.ok(TROP_GENERIQUES.has('fracture'));
});

test('un terme partagé par deux thèmes n’est cherché qu’une fois', () => {
  const { termes } = sujetDepuisThemes({ A: ['insulin'], B: ['insulin', 'metformin'] });
  assert.equal(termes, 2);
});

test('preparerSources ne réécrit que les sources qui délèguent leur sujet aux thèmes', () => {
  const config = {
    themes: { Diabète: ['metformin'] },
    sources: [
      { id: 'a', sujet: 'themes', filtre: 'PUB_TYPE:"Meta-Analysis"' },
      { id: 'b', sujet: 'themes' },
      { id: 'c', query: 'JOURNAL:"Diabetes Care"' },
    ],
  };
  preparerSources(config);
  assert.equal(config.sources[0].query, '(TITLE_ABS:metformin*) AND PUB_TYPE:"Meta-Analysis"');
  assert.equal(config.sources[1].query, '(TITLE_ABS:metformin*)');
  assert.equal(config.sources[2].query, 'JOURNAL:"Diabetes Care"', 'une query explicite reste intacte');
});

test('un thème rendu par le modèle est rabattu sur la liste officielle', () => {
  const liste = ['Diabète', 'Os & calcium', 'Autre'];
  assert.equal(themeOfficiel('diabete', liste, 'Autre'), 'Diabète');
  assert.equal(themeOfficiel('  OS & CALCIUM ', liste, 'Autre'), 'Os & calcium');
});

test('un thème hors liste retombe sur le repli, jamais sur une valeur inventée', () => {
  const liste = ['Diabète', 'Autre'];
  assert.equal(themeOfficiel('Néphrologie', liste, 'Autre'), 'Autre');
  assert.equal(themeOfficiel(undefined, liste, 'Autre'), 'Autre');
});

test('le config du dépôt donne un vocabulaire à chaque thème et une requête non vide', () => {
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  for (const [theme, mots] of Object.entries(config.themes)) {
    assert.ok(Array.isArray(mots), `le thème « ${theme} » n’est pas une liste`);
    // « Autre » est le fourre-tout : il n’a de vocabulaire ni pour chercher ni pour classer.
    if (theme !== 'Autre') assert.ok(mots.length, `le thème « ${theme} » n’a aucun terme`);
  }
  const { termes } = sujetDepuisThemes(config.themes);
  assert.ok(termes > 50, `vocabulaire anormalement court : ${termes} termes`);
});
