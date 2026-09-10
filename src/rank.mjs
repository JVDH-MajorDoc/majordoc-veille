// MajorDoc — scoring et sélection des articles à résumer.
// Objectif : ne payer un résumé LLM que pour ce qui mérite 2 minutes du médecin.

import { TROP_GENERIQUES } from './vocabulaire.mjs';

const norm = (s) => (s || '').toLowerCase();

/**
 * Le vocabulaire de la spécialité, à plat, débarrassé des termes trop généraux.
 * Mémoïsé : la liste ne change pas d'un article à l'autre.
 */
let _motsCache = null, _themesCache = null;
function motsSpecialite(themes) {
  if (themes === _themesCache) return _motsCache;
  _themesCache = themes;
  _motsCache = [...new Set(Object.values(themes ?? {}).flat().map(norm))]
    .filter((m) => m && !TROP_GENERIQUES.has(m));
  return _motsCache;
}

/**
 * Le titre décide, le résumé départage.
 *
 * Deux biais se cumulaient. D'abord la taille du vocabulaire : « Diabète »
 * compte une vingtaine de termes, « Surrénale » une douzaine, et comme les
 * occurrences s'additionnaient, le thème le mieux doté gagnait presque
 * toujours. Ensuite le résumé : le diabète est mentionné en passant dans la
 * moitié des résumés d'endocrinologie. Résultat, dans l'audit du 13 août 2026,
 * un essai randomisé de surrénalectomie pour sécrétion autonome de cortisol
 * était rangé dans « Diabète » — où il disputait le quota du thème à de vrais
 * articles de diabétologie, et le perdait.
 *
 * On compte donc des termes DISTINCTS, pas des occurrences, et on regarde
 * d'abord le titre : c'est là qu'un article annonce son sujet.
 */
function distincts(texte, motsCles) {
  let n = 0;
  for (const mot of motsCles) {
    const m = norm(mot);
    if (m && texte.includes(m)) n++;
  }
  return n;
}

export function detecterTheme(article, themes) {
  const titre = norm(article.titre);
  const resume = norm(article.resume);

  let meilleur = { theme: 'Autre', titre: 0, resume: 0 };
  for (const [theme, motsCles] of Object.entries(themes)) {
    if (!motsCles?.length) continue;
    const t = distincts(titre, motsCles);
    const r = distincts(resume, motsCles);
    // Un thème annoncé dans le titre prime sur tout thème qui ne l'est pas ;
    // à égalité de titre, le résumé départage.
    if (t > meilleur.titre || (t === meilleur.titre && r > meilleur.resume)) {
      meilleur = { theme, titre: t, resume: r };
    }
  }
  return meilleur.titre || meilleur.resume ? meilleur.theme : 'Autre';
}

export function typeEtude(article) {
  const t = article.types.map(norm);
  const has = (x) => t.some((v) => v.includes(x));
  if (has('practice guideline') || has('guideline') || has('consensus')) return 'Recommandation';
  if (has('meta-analysis')) return 'Méta-analyse';
  if (has('systematic review')) return 'Revue systématique';
  if (has('randomized controlled trial')) return 'Essai randomisé';
  if (has('clinical trial')) return 'Essai clinique';
  if (has('observational study') || has('cohort')) return 'Étude observationnelle';
  if (has('case reports')) return 'Cas clinique';
  if (has('review')) return 'Revue';
  if (has('editorial') || has('comment')) return 'Éditorial';
  return 'Article original';
}

export function scorer(article, config) {
  let score = 0;
  const details = {};

  // 1. Poids de la source qui l'a remonté
  details.source = article.poidsSource ?? 1;
  score += details.source;

  // 2. Présence dans plusieurs requêtes = signal de pertinence
  details.recoupement = Math.min((article.sources?.length ?? 1) - 1, 3) * 0.8;
  score += details.recoupement;

  // 3. Type d'étude
  let bonusType = 0;
  for (const t of article.types.map(norm)) {
    for (const [cle, val] of Object.entries(config.types_prioritaires ?? {})) {
      if (t.includes(cle)) bonusType = Math.max(bonusType, val);
    }
    for (const [cle, val] of Object.entries(config.penalites ?? {})) {
      if (t.includes(cle)) bonusType += val;
    }
  }
  details.type = bonusType;
  score += bonusType;

  // 4. Journal
  let bonusJournal = 0;
  const j = norm(article.journal);
  const ja = norm(article.journalAbrege);
  for (const [cle, val] of Object.entries(config.journaux_prioritaires ?? {})) {
    const k = norm(cle);
    if (j === k || ja === k || j.includes(k) || ja.includes(k)) bonusJournal = Math.max(bonusJournal, val);
  }
  // Symétrique du bonus : certaines revues à très gros volume trustent les
  // places sans apporter de quoi changer une consultation. La clé « _commentaire »
  // du bloc est de la documentation, pas une revue — on l'ignore.
  let malusJournal = 0;
  for (const [cle, val] of Object.entries(config.journaux_penalises ?? {})) {
    if (cle.startsWith('_') || typeof val !== 'number') continue;
    const k = norm(cle);
    if (j === k || ja === k || j.includes(k) || ja.includes(k)) malusJournal = Math.min(malusJournal, val);
  }

  details.journal = bonusJournal + malusJournal;
  score += details.journal;

  // 5. Fraîcheur (0 à 2 pts, décroît sur la fenêtre)
  if (article.date) {
    const jours = Math.max(0, (Date.now() - new Date(article.date).getTime()) / 86400000);
    details.fraicheur = Math.max(0, 2 - jours * 0.25);
    score += details.fraicheur;
  }

  // 6. Abstract structuré / substantiel
  details.substance = article.resume.length > 900 ? 1 : article.resume.length > 500 ? 0.5 : 0;
  score += details.substance;

  // 7. Accès libre : le médecin pourra lire l'article en entier
  details.acces = article.accesLibre ? 0.5 : 0;
  score += details.acces;

  // 8. Le titre annonce-t-il un travail qui ne sert pas la consultation ?
  //
  // Phase I chez le volontaire sain, bibliométrie, protocole sans résultats,
  // travail préclinique : de la bonne science, sans effet sur une prise en charge
  // cette semaine. Ce n'est pas un jugement de qualité, c'est un critère d'usage.
  let malusTitre = 0;
  for (const [motif, val] of Object.entries(config.titres_penalises ?? {})) {
    if (motif.startsWith('_') || typeof val !== 'number') continue;
    try {
      if (new RegExp(motif, 'i').test(article.titre)) malusTitre += val;
    } catch { /* motif mal formé : on l'ignore plutôt que d'interrompre la veille */ }
  }
  details.titrePenalise = malusTitre;
  score += malusTitre;

  // 9. Le sujet est-il annoncé dans le titre ?
  //
  // Chercher dans le résumé est nécessaire — beaucoup d'articles pertinents ne
  // nomment la maladie qu'au fil du texte. Mais l'inverse est vrai aussi : une
  // étude sur le gingembre et la tension mentionne « nutrition » dans son
  // résumé sans concerner une endocrinologue une seule seconde. Un article dont
  // le titre ne contient aucun mot de la spécialité n'est pas écarté — il est
  // relégué, ce qui suffit quand un millier de candidats se disputent douze places.
  const titre = norm(article.titre);
  details.sujetEnTitre = motsSpecialite(config.themes).some((m) => titre.includes(m)) ? 0 : -4;
  score += details.sujetEnTitre;

  return { score: Math.round(score * 100) / 100, details };
}

export function classer(articles, config) {
  const enrichis = articles.map((a) => {
    const { score, details } = scorer(a, config);
    return {
      ...a,
      score,
      scoreDetails: details,
      theme: detecterTheme(a, config.themes ?? {}),
      typeEtude: typeEtude(a),
    };
  });

  enrichis.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? ''));
  return enrichis;
}

/**
 * Sélection finale : on prend les meilleurs, en garantissant une diversité
 * de thèmes (pas 12 articles sur le diabète le même jour).
 */
export function selectionner(classes, { max = 12, maxParTheme = 4, maxParRevue = 2 } = {}) {
  const retenus = [];
  const compteur = new Map();
  const parRevue = new Map();
  const cleRevue = (a) => norm(a.journalAbrege || a.journal || '?');

  for (const a of classes) {
    if (retenus.length >= max) break;
    const n = compteur.get(a.theme) ?? 0;
    if (n >= maxParTheme) continue;
    // Trois articles de la même revue le même matin, c'est le sommaire d'un
    // numéro qui vient de paraître, pas un panorama de la littérature.
    const r = parRevue.get(cleRevue(a)) ?? 0;
    if (r >= maxParRevue) continue;
    retenus.push(a);
    compteur.set(a.theme, n + 1);
    parRevue.set(cleRevue(a), r + 1);
  }
  // Deuxième passe si le quota par thème nous a laissés courts
  if (retenus.length < max) {
    for (const a of classes) {
      if (retenus.length >= max) break;
      if (!retenus.includes(a)) retenus.push(a);
    }
  }
  return retenus;
}
