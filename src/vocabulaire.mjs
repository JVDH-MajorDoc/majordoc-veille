// MajorDoc — le vocabulaire de la spécialité, en un seul endroit.
//
// Jusqu'au 13 août 2026, MajorDoc entretenait deux vocabulaires sans le dire :
// une petite liste dans les requêtes Europe PMC, qui décidait de ce qu'on allait
// CHERCHER, et la liste `themes` du config, bien plus riche, qui décidait de la
// façon de RANGER ce qu'on avait trouvé. Rien ne les tenait synchronisés. Le
// board savait donc classer une fiche « Surrénale » sans jamais pouvoir en
// trouver une : ni Cushing, ni Addison, ni cortisol ne figuraient dans la
// requête. Un rayonnage soigneux devant un panier presque vide.
//
// Désormais la requête est fabriquée à partir de `themes`. Ajouter un mot à un
// thème étend du même geste ce qu'on cherche et la façon dont c'est classé —
// et rend la duplication vers une autre spécialité franchement plus sûre :
// il n'y a qu'une liste à réécrire.

/**
 * Termes conservés pour le classement mais écartés de la recherche.
 *
 * Ils font leur travail une fois l'article déjà identifié comme endocrinien —
 * « fracture » range correctement une fiche dans « Os & calcium ». Employés
 * comme critère de recherche, ils ramèneraient toute la traumatologie. La
 * distinction n'est pas cosmétique : elle sépare « ce qui définit la
 * spécialité » de « ce qui en décrit le contenu ».
 */
export const TROP_GENERIQUES = new Map([
  ['tumor', 'toute la cancérologie'],
  ['tumour', 'idem, graphie britannique'],
  ['carcinoma', 'toute la cancérologie'],
  ['adenoma', 'polypes coliques, adénomes de tout organe'],
  ['fracture', 'toute la traumatologie'],
  ['calcium', 'omniprésent en biologie cellulaire'],
  ['bmi', 'variable d\'ajustement de presque toute étude épidémiologique'],
  ['ovarian', 'très majoritairement du cancer de l\'ovaire'],
  ['glucose', 'métabolisme cellulaire de toute la biologie'],
  ['nutrition', 'discipline entière : diététique hospitalière, santé publique, agroalimentaire'],
  ['malnutrition', 'gériatrie et réanimation pour l\'essentiel'],
  ['micronutrient', 'supplémentation tous domaines confondus'],
]);

/** Un terme composé se cherche comme expression exacte ; un radical se tronque. */
function terme(mot) {
  const m = String(mot).trim().toLowerCase();
  if (!m) return null;
  if (/[\s'-]/.test(m)) return `TITLE_ABS:"${m}"`;
  return `TITLE_ABS:${m}*`;
}

/**
 * Construit le bloc « sujet » de la requête à partir des thèmes du config.
 * Renvoie aussi ce qui a été écarté, pour que l'outil de diagnostic puisse
 * le montrer plutôt que de le taire.
 */
export function sujetDepuisThemes(themes = {}) {
  const gardes = [];
  const ecartes = [];
  const vus = new Set();

  for (const mots of Object.values(themes)) {
    for (const mot of mots ?? []) {
      const m = String(mot).trim().toLowerCase();
      if (!m || vus.has(m)) continue;
      vus.add(m);
      if (TROP_GENERIQUES.has(m)) { ecartes.push(m); continue; }
      const t = terme(m);
      if (t) gardes.push(t);
    }
  }

  return { sujet: `(${gardes.join(' OR ')})`, termes: gardes.length, ecartes };
}

/**
 * Complète les sources qui déclarent `"sujet": "themes"` : leur `query` devient
 * le bloc sujet, combiné à leur propre `filtre` (type de publication, langue…).
 * Les sources qui portent déjà une `query` explicite ne sont pas touchées.
 */
export function preparerSources(config) {
  const { sujet, termes, ecartes } = sujetDepuisThemes(config.themes);
  for (const source of config.sources ?? []) {
    if (source.sujet !== 'themes') continue;
    source.query = source.filtre ? `${sujet} AND ${source.filtre}` : sujet;
  }
  return { termes, ecartes };
}

/**
 * Rabat un thème rendu par le modèle sur la liste officielle du config,
 * en ignorant accents, casse et espaces parasites. Un thème qui ne
 * correspond à rien retombe sur le repli fourni — jamais sur une valeur
 * inventée : un thème hors liste fragmente les filtres et les préférences
 * des lectrices en autant de doublons.
 */
export function themeOfficiel(brut, liste, repli) {
  const cle = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const c = cle(brut);
  return liste.find((t) => cle(t) === c) ?? repli;
}
