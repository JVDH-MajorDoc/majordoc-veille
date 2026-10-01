// Appels à l'API Claude — forme des requêtes et lecture des réponses, sans
// réseau : fetch est remplacé par un faux qui enregistre ce qu'on lui envoie.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ficher, ficherReco, redigerEdito, lireJson, bornerInteret, modeleCompatible, corpsRequete, MODELE_DEFAUT,
} from '../src/summarize.mjs';

const article = {
  titre: 'GLP-1 discontinuation and weight regain', journal: 'BMJ', date: '2026-09-01',
  types: ['Meta-Analysis'], auteurs: 'Doe J', resume: 'Participants regained 62% of lost weight.',
};

const ficheModele = {
  titre_fr: 'Reprise de poids après arrêt des GLP-1', accroche: 'Deux tiers du poids perdu reviennent en un an.',
  contexte: 'c', methode: 'm', resultats: 'r', conclusion: 'k', pour_la_pratique: 'p', limites: 'l',
  niveau_preuve: 'Modéré', theme: 'Obésité & nutrition', mots_cles: ['GLP-1'], interet: 4,
};

/** Remplace fetch le temps d'un test ; rend la liste des requêtes envoyées. */
function fauxFetch(t, reponse, status = 200) {
  const envois = [];
  const avant = globalThis.fetch;
  const cleAvant = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  globalThis.fetch = async (url, init) => {
    envois.push({ url, headers: init.headers, corps: init.body ? JSON.parse(init.body) : null });
    return { status, ok: status < 400, json: async () => reponse };
  };
  t.after(() => {
    globalThis.fetch = avant;
    if (cleAvant === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = cleAvant;
  });
  return envois;
}

const reponseJson = (obj, extra = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
  usage: { input_tokens: 900, output_tokens: 400 },
  ...extra,
});

test('une fiche est demandée en sortie structurée, sans tool_choice forcé', async (t) => {
  const envois = fauxFetch(t, reponseJson(ficheModele));
  const { fiche, usage } = await ficher(article, { modele: 'claude-sonnet-5-5', themes: ['Diabète', 'Obésité & nutrition'] });

  assert.equal(fiche.titre_fr, ficheModele.titre_fr);
  assert.equal(usage.output_tokens, 400);

  const { corps, headers } = envois[0];
  assert.equal(corps.model, 'claude-sonnet-5-5');
  assert.equal(corps.tool_choice, undefined, 'Sonnet 5.5 rejette tool_choice forcé (400)');
  assert.equal(corps.tools, undefined);
  assert.equal(corps.thinking, undefined, 'thinking disabled renvoie 400 sur Sonnet 5.5');
  assert.equal(corps.temperature, undefined);
  assert.equal(corps.output_config.effort, 'low');
  assert.equal(corps.output_config.format.type, 'json_schema');
  assert.ok(corps.max_tokens >= 8000, 'la réflexion compte dans max_tokens');
  assert.deepEqual(corps.output_config.format.schema.properties.theme.enum, ['Diabète', 'Obésité & nutrition', 'Autre']);
  assert.equal(corps.fallbacks, 'default');
  assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

/**
 * Mots-clés JSON Schema que les sorties structurées refusent (HTTP 400). Le
 * 01/10/2026, un `minimum` oublié dans le schéma des articles a fait échouer
 * toutes les fiches du jour : ce test passe désormais les TROIS schémas, en
 * profondeur, et non plus un seul.
 */
const REFUSES = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern'];
function verifierSchema(schema, chemin = 'schéma') {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${chemin} : additionalProperties doit valoir false`);
    assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties ?? {}).sort(), `${chemin} : toutes les propriétés requises`);
    for (const [k, v] of Object.entries(schema.properties ?? {})) verifierSchema(v, `${chemin}.${k}`);
  }
  if (schema.items) verifierSchema(schema.items, `${chemin}[]`);
  for (const mot of REFUSES) assert.equal(schema[mot], undefined, `${chemin} : « ${mot} » refusé par les sorties structurées`);
}

test('les trois schémas (article, reco, édito) n’emploient que ce que l’API accepte', async (t) => {
  const envois = fauxFetch(t, reponseJson({ ...ficheModele, type: 'Avis', titre_court: 't', ce_qui_change: 'c', points_cles: [], population: 'p', certitude: 'Titre seul', titre: 'T', points: [], a_lire_en_priorite: 'x' }));
  const themes = ['Diabète', 'Thyroïde'];
  await ficher(article, { modele: 'claude-sonnet-5-5', themes });
  await ficherReco({ titre: 'Avis HAS' }, { modele: 'claude-sonnet-5-5', themes });
  await redigerEdito([], { modele: 'claude-sonnet-5-5' });
  assert.equal(envois.length, 3);
  for (const [i, nom] of ['article', 'reco', 'édito'].entries()) {
    verifierSchema(envois[i].corps.output_config.format.schema, nom);
  }
});

test('le repli sur refus peut être coupé depuis le config', async (t) => {
  const envois = fauxFetch(t, reponseJson({ titre: 'T', points: ['a'], a_lire_en_priorite: 'x' }));
  const { edito } = await redigerEdito([], { modele: 'claude-sonnet-5-5', repli: null, effort: 'medium' });
  assert.equal(edito.titre, 'T');
  assert.equal(envois[0].corps.fallbacks, undefined);
  assert.equal(envois[0].headers['anthropic-beta'], undefined);
  assert.equal(envois[0].corps.output_config.effort, 'medium');
});

test('un refus est signalé, pas lu comme une fiche', () => {
  assert.throws(
    () => lireJson({ stop_reason: 'refusal', stop_details: { category: 'bio' }, content: [{ type: 'text', text: '{}' }] }),
    /décliné.*bio/
  );
});

test('une réponse tronquée est signalée, pas parsée à moitié', () => {
  assert.throws(() => lireJson({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"titre' }] }), /tronquée/);
});

test('les blocs sont lus par type : un bloc de réflexion en tête ne gêne pas', () => {
  const r = lireJson({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] });
  assert.deepEqual(r, { a: 1 });
});

test('les échappements \\uXXXX restés en clair sont décodés dans la fiche', async (t) => {
  fauxFetch(t, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...ficheModele, theme: 'Diab\\u00e8te' }) }] });
  const { fiche } = await ficher(article, { modele: 'claude-sonnet-5-5' });
  assert.equal(fiche.theme, 'Diabète');
});

test('l’intérêt est ramené entre 1 et 5', () => {
  assert.equal(bornerInteret({ interet: 9 }).interet, 5);
  assert.equal(bornerInteret({ interet: 0 }).interet, 1);
  assert.equal(bornerInteret({ interet: 3.6 }).interet, 4);
  assert.equal(bornerInteret({ interet: 'x' }).interet, 3);
});

test('un modèle Sonnet 4.x laissé dans un ancien config est remplacé', (t) => {
  const avertir = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = avertir; });
  assert.equal(modeleCompatible('claude-sonnet-4-5'), MODELE_DEFAUT);
  assert.equal(modeleCompatible('claude-sonnet-4-5-20250929'), MODELE_DEFAUT);
  assert.equal(modeleCompatible('claude-3-5-sonnet-20241022'), MODELE_DEFAUT);
  assert.equal(modeleCompatible(undefined), MODELE_DEFAUT);
  assert.equal(modeleCompatible('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(modeleCompatible('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(modeleCompatible('claude-opus-5-5'), 'claude-opus-5-5');
});

test('corpsRequete n’ajoute rien que Sonnet 5.5 refuse', () => {
  const c = corpsRequete({ modele: 'claude-sonnet-5-5', maxTokens: 8000, systeme: 's', schema: { type: 'object' }, contenu: 'x' });
  assert.deepEqual(Object.keys(c).sort(), ['fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'system']);
});

test('l’erreur de l’API garde son code et son message', async (t) => {
  fauxFetch(t, { error: { message: 'output_config.format: schema invalide' } }, 400);
  await assert.rejects(
    ficher(article, { modele: 'claude-sonnet-5-5', repli: null }),
    (e) => e.status === 400 && /HTTP 400 — output_config\.format: schema invalide/.test(e.message)
  );
});

// En dernier : ce test désactive le repli pour le reste du module.
test('si l’API rejette le repli sur refus, la fiche est redemandée sans lui', async (t) => {
  const envois = [];
  const avant = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  globalThis.fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    envois.push(corps);
    return corps.fallbacks
      ? { status: 400, ok: false, json: async () => ({ error: { message: 'fallbacks: not supported' } }) }
      : { status: 200, ok: true, json: async () => reponseJson(ficheModele) };
  };
  const avertir = console.warn; const avertissements = [];
  console.warn = (m) => avertissements.push(m);
  t.after(() => { globalThis.fetch = avant; console.warn = avertir; });

  const { fiche } = await ficher(article, { modele: 'claude-sonnet-5-5' });
  assert.equal(fiche.titre_fr, ficheModele.titre_fr);
  assert.equal(envois.length, 2);
  assert.equal(envois[1].fallbacks, undefined);
  assert.match(avertissements[0], /Repli sur refus rejeté/);

  // Les fiches suivantes partent directement sans repli : une requête, pas deux.
  await ficher(article, { modele: 'claude-sonnet-5-5' });
  assert.equal(envois.length, 3);
  assert.equal(avertissements.length, 1);
});
