// MajorDoc — résumés structurés en français via l'API Claude.
// Sortie garantie par les « sorties structurées » (output_config.format) : la
// réponse est contrainte par un schéma JSON côté serveur, pas du JSON libre.
// (Jusqu'au 01/10/2026 on forçait un appel d'outil ; Sonnet 5.5 refuse le
// tool_choice forcé — erreur 400 — d'où ce changement de mécanisme.)

const API = 'https://api.anthropic.com/v1';

function cle() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) {
    // `fatal` court-circuite les nouvelles tentatives : une clé absente ne
    // guérit pas en réessayant, et chaque essai perdu coûte des secondes.
    throw Object.assign(
      new Error("Clé API manquante. Faites : export ANTHROPIC_API_KEY='sk-ant-...' " +
        '(ou renseignez-la dans le fichier .env à la racine du projet).'),
      { fatal: true }
    );
  }
  return k;
}

async function appel(chemin, body, { essais = 3, betas = [] } = {}) {
  let derniereErreur;
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(`${API}${chemin}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'x-api-key': cle(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!r.ok) {
        throw Object.assign(new Error(`HTTP ${r.status} — ${data?.error?.message ?? 'sans détail'}`),
          { fatal: r.status < 500 && r.status !== 429, status: r.status });
      }
      return data;
    } catch (e) {
      derniereErreur = e;
      if (e.fatal) break;
      await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
    }
  }
  throw derniereErreur;
}

export const MODELE_DEFAUT = 'claude-sonnet-5-5';

/**
 * Modèles que ce code ne sait plus appeler : il s'appuie sur output_config
 * (effort + sorties structurées), que la génération Sonnet 4 refuse. Le
 * config.json d'un serveur n'est jamais réécrit par une mise à jour : un
 * « claude-sonnet-4-5 » resté en place y est donc remplacé ici, à voix haute,
 * plutôt que de faire échouer toutes les fiches le lendemain matin.
 */
const INCOMPATIBLES = /^claude-(2|3|instant|sonnet-4|haiku-4)/;

export function modeleCompatible(souhaite) {
  if (!souhaite) return MODELE_DEFAUT;
  if (!INCOMPATIBLES.test(souhaite)) return souhaite;
  console.warn(`  ! Modèle "${souhaite}" obsolète (Sonnet 4.5 est retiré le 24/11/2026) — utilisation de "${MODELE_DEFAUT}".` +
    ' Mettez à jour anthropic dans config.json (voir INSTALLATION.md).');
  return MODELE_DEFAUT;
}

/** Vérifie que le modèle configuré existe ; sinon retombe sur le Sonnet le plus récent. */
export async function resoudreModele(demande) {
  const souhaite = modeleCompatible(demande);
  try {
    const { data } = await appel('/models?limit=100', null, { essais: 2 });
    const ids = (data ?? []).map((m) => m.id);
    if (ids.some((id) => id === souhaite || id.startsWith(souhaite))) {
      return ids.find((id) => id === souhaite) ?? ids.find((id) => id.startsWith(souhaite));
    }
    const sonnet = ids.filter((id) => id.includes('sonnet')).sort().pop();
    if (sonnet) {
      console.warn(`  ! Modèle "${souhaite}" introuvable — utilisation de "${sonnet}".`);
      return sonnet;
    }
  } catch {
    /* on tente quand même avec le modèle demandé */
  }
  return souhaite;
}

/**
 * Liste de repli si l'appelant ne fournit pas les thèmes du config. Le vrai
 * référentiel vit dans config.json → themes : cette énumération a déjà divergé
 * une fois (trois thèmes ajoutés au config le 13/08/2026, invisibles sur le
 * board parce que le schéma imposé au modèle n'en savait rien).
 */
const THEMES_DEFAUT = [
  'Diabète', 'Obésité & nutrition', 'Thyroïde', 'Surrénale', 'Hypophyse',
  'Os & calcium', 'Gonades & fertilité', 'Onco-endocrinologie', 'Autre',
];

/**
 * Les modèles écrivent parfois un échappement JSON littéral — « Diab\\u00e8te » —
 * au lieu du caractère qu'il désigne. Vu en production le 21/08/2026 : le thème
 * s'affichait tel quel sur le board et créait un doublon dans les préférences.
 * On décode donc toute séquence \\uXXXX restée en clair, dans chaque champ.
 */
export function decoderEchappements(x) {
  if (typeof x === 'string') {
    if (x.indexOf('\\u') === -1) return x;
    return x.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  if (Array.isArray(x)) return x.map(decoderEchappements);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[decoderEchappements(k)] = decoderEchappements(v);
    return o;
  }
  return x;
}

/** Rebranche l'énumération des thèmes d'un schéma sur la liste du config. */
export function avecThemes(schema, themes) {
  if (!themes?.length) return schema;
  const liste = [...themes.filter((t) => t !== 'Autre'), 'Autre'];
  return { ...schema, properties: { ...schema.properties, theme: { type: 'string', enum: liste } } };
}

/**
 * Les sorties structurées n'acceptent pas les bornes numériques (minimum /
 * maximum) dans le schéma : la borne est écrite dans la description pour le
 * modèle, et appliquée ici, à la réception.
 */
export function bornerInteret(fiche) {
  const n = Math.round(Number(fiche?.interet));
  if (fiche) fiche.interet = Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
  return fiche;
}

/**
 * Prépare l'appel commun aux trois rédactions (fiche, reco, édito).
 * - output_config.format : la réponse est un JSON conforme au schéma.
 * - output_config.effort : Sonnet 5.5 réfléchit avant de répondre (réflexion
 *   « adaptative », impossible à couper sur ce modèle). « low » la réserve aux
 *   cas qui le méritent : c'est le réglage conseillé pour de l'extraction et
 *   du résumé. La réflexion compte dans max_tokens, d'où des plafonds plus
 *   larges qu'avec Sonnet 4.5.
 * - fallbacks : si le modèle décline une requête (refus de sécurité), l'API la
 *   rejoue elle-même sur le modèle de repli recommandé, dans le même appel.
 */
export function corpsRequete({ modele, maxTokens, systeme, schema, contenu, effort = 'low', repli = 'default' }) {
  const corps = {
    model: modele,
    max_tokens: maxTokens,
    system: systeme,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: contenu }],
  };
  if (repli) corps.fallbacks = repli;
  return corps;
}

/**
 * Lit la réponse d'une sortie structurée. On vérifie le motif d'arrêt AVANT
 * le contenu : un refus ou une réponse tronquée ne respecte pas le schéma.
 * Les blocs sont lus par type, jamais par position (la réponse peut commencer
 * par un bloc de réflexion, vide).
 */
export function lireJson(data) {
  if (data?.stop_reason === 'refusal') {
    const cat = data.stop_details?.category;
    throw new Error(`Le modèle a décliné la demande${cat ? ` (${cat})` : ''}`);
  }
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('Réponse tronquée (max_tokens atteint) — augmentez anthropic.max_tokens dans config.json');
  }
  const texte = (data?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (!texte.trim()) throw new Error('Réponse sans contenu exploitable');
  try {
    return JSON.parse(texte);
  } catch {
    throw new Error('Réponse JSON illisible');
  }
}

/** Appel brut à l'API, pour l'outil de diagnostic (src/diag-ia.mjs). */
export const appelAPI = appel;

/**
 * Le repli sur refus est une fonction beta : si l'API la rejette (requête
 * invalide), on la retire pour le reste de l'exécution plutôt que de perdre
 * toutes les fiches du jour. Un avertissement le dit dans le journal.
 */
let repliRejete = false;

async function rediger(params) {
  const repli = repliRejete ? null : (params.repli === undefined ? 'default' : params.repli);
  const envoyer = (r) => appel('/messages', corpsRequete({ ...params, repli: r }), {
    betas: r ? ['server-side-fallback-2026-07-01'] : [],
  });
  let data;
  try {
    data = await envoyer(repli);
  } catch (e) {
    if (!repli || e.status !== 400) throw e;
    data = await envoyer(null);
    if (!repliRejete) {
      repliRejete = true;
      console.warn(`  ! Repli sur refus rejeté par l'API (${e.message}) — désactivé pour cette exécution.` +
        ' Mettez anthropic.repli_refus à null dans config.json.');
    }
  }
  return { sortie: decoderEchappements(lireJson(data)), usage: data.usage ?? {} };
}

const SCHEMA_FICHE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titre_fr: { type: 'string', description: 'Titre traduit en français, fidèle et lisible. Pas de majuscules inutiles.' },
    accroche: {
      type: 'string',
      description:
        "LE message à retenir, en une phrase de 20 à 30 mots, avec le chiffre clé si disponible. C'est ce que le médecin lit en 3 secondes.",
    },
    contexte: { type: 'string', description: 'Question posée et pourquoi elle se pose. 1 à 2 phrases.' },
    methode: { type: 'string', description: "Design, population, effectif, comparateur, critère de jugement principal, durée. 1 à 3 phrases, chiffrées." },
    resultats: { type: 'string', description: 'Résultats principaux CHIFFRÉS (effets, IC95%, p, NNT si pertinent). 2 à 4 phrases.' },
    conclusion: { type: 'string', description: "Conclusion des auteurs, reformulée sobrement. 1 à 2 phrases." },
    pour_la_pratique: {
      type: 'string',
      description:
        "Ce que ça change (ou non) pour un endocrinologue en consultation demain. Sois honnête : « rien pour l'instant » est une réponse valide et utile.",
    },
    limites: { type: 'string', description: 'La ou les 2 limites méthodologiques majeures. 1 à 2 phrases.' },
    niveau_preuve: {
      type: 'string',
      enum: ['Élevé', 'Modéré', 'Faible', 'Très faible'],
      description: "Niveau de preuve global, esprit GRADE : design, effectif, risque de biais, précision.",
    },
    theme: { type: 'string', enum: THEMES_DEFAUT },
    mots_cles: { type: 'array', items: { type: 'string' }, description: '3 à 5 mots-clés français.' },
    interet: {
      type: 'integer',
      description:
        "Intérêt clinique pour un endocrinologue français, entier de 1 à 5. 5 = change la pratique ou une reco. 3 = bon à savoir. 1 = anecdotique / très spécialisé.",
    },
  },
  required: [
    'titre_fr',
    'accroche',
    'contexte',
    'methode',
    'resultats',
    'conclusion',
    'pour_la_pratique',
    'limites',
    'niveau_preuve',
    'theme',
    'mots_cles',
    'interet',
  ],
};

/** Le schéma de fiche tel qu'il part à l'API, pour l'outil de diagnostic. */
export function schemaFiche(themes) { return avecThemes(SCHEMA_FICHE, themes); }

const SYSTEME = `Tu es un endocrinologue-diabétologue français, lecteur critique aguerri, qui prépare la revue de presse quotidienne de ses confrères.

Règles absolues :
- Tu écris en français médical courant, précis, sans jargon anglais inutile (mais tu gardes les acronymes consacrés : HbA1c, GLP-1, SGLT2, IC95%, HR, OR, NNT).
- Tu es FIDÈLE à l'abstract fourni. Tu n'inventes jamais un chiffre, un effectif ou une conclusion. Si une information n'est pas dans l'abstract, tu ne la mentionnes pas.
- Tu privilégies les chiffres aux adjectifs : « -0,8 % d'HbA1c (IC95% -1,0 à -0,6) » et non « une baisse significative ».
- Tu es sobre : pas de superlatif, pas de « révolutionnaire », pas d'enthousiasme commercial.
- Tu signales les conflits d'intérêts évidents (essai financé par l'industriel du produit testé) s'ils apparaissent dans le texte.
- Style télégraphique assumé : le lecteur a 90 secondes.`;

function prompt(article) {
  return `Voici un article à ficher.

TITRE ORIGINAL : ${article.titre}
REVUE : ${article.journal || 'non précisée'}
DATE : ${article.date || 'non précisée'}
TYPES (MEDLINE) : ${article.types.join(', ') || 'non précisés'}
AUTEURS : ${(article.auteurs || '').slice(0, 300)}

ABSTRACT :
${article.resume}

Rédige la fiche de lecture de cet article.`;
}

export async function ficher(article, { modele, maxTokens = 8000, themes, effort, repli }) {
  const { sortie, usage } = await rediger({
    modele, maxTokens, effort, repli,
    systeme: SYSTEME,
    schema: avecThemes(SCHEMA_FICHE, themes),
    contenu: prompt(article),
  });
  return { fiche: bornerInteret(sortie), usage };
}

/* --------------------------------------------------------------------------
   Recommandations françaises (HAS, SFE, SFD…)
   Texte déjà en français : pas de traduction, l'enjeu est « qu'est-ce qui change ».
   -------------------------------------------------------------------------- */

const SCHEMA_RECO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titre_court: { type: 'string', description: 'Titre reformulé, clair et court (10 à 16 mots). Sans sigle inutile.' },
    accroche: { type: 'string', description: "Ce que dit le texte, en une phrase de 20 à 30 mots." },
    ce_qui_change: {
      type: 'string',
      description:
        "Ce que ça modifie par rapport à la pratique antérieure. Si c'est une confirmation ou une simple actualisation de forme, le dire franchement.",
    },
    points_cles: { type: 'array', items: { type: 'string' }, description: '3 à 5 points, une phrase chacun, les plus opérationnels.' },
    population: { type: 'string', description: "À qui ça s'applique : population, situation clinique, cadre de prescription." },
    pour_la_pratique: {
      type: 'string',
      description:
        "Ce que le texte demande de faire différemment, tel qu'il l'écrit. Rester descriptif et attribuer : " +
        "c'est la recommandation qui prescrit, pas cette fiche.",
    },
    type: {
      type: 'string',
      enum: ['Recommandation', 'Consensus', 'Avis', 'Fiche mémo', 'Actualité', 'Autre'],
    },
    theme: { type: 'string', enum: THEMES_DEFAUT },
    interet: { type: 'integer', description: "Intérêt pour la pratique d'un endocrinologue français, entier de 1 à 5. 5 = texte opposable." },
    certitude: {
      type: 'string',
      enum: ['Texte complet lu', 'Résumé seul', 'Titre seul'],
      description: "Honnêteté sur la matière disponible : si seul le titre était fourni, le dire.",
    },
  },
  required: ['titre_court', 'accroche', 'ce_qui_change', 'points_cles', 'population', 'pour_la_pratique', 'type', 'theme', 'interet', 'certitude'],
};

const SYSTEME_RECO = `Tu es un endocrinologue-diabétologue français qui dépouille les publications des organismes officiels (HAS, SFE, SFD) pour ses confrères.

Règles absolues :
- Le texte fourni est déjà en français : tu ne traduis pas, tu synthétises.
- Tu es FIDÈLE au texte fourni. Tu n'inventes aucune recommandation, aucun seuil, aucun chiffre. Si le texte disponible est mince, tu remplis « certitude » en conséquence et tu restes prudent plutôt que d'extrapoler.
- Une recommandation n'est pas une nouveauté par principe : beaucoup de publications sont des actualisations mineures. Dis-le quand c'est le cas, dans « ce_qui_change ».
- Tu distingues ce qui est opposable (recommandation de bonne pratique, avis officiel) de ce qui est indicatif (position de société savante, actualité).
- Tu rapportes ce que le texte dit ; tu ne prescris jamais en ton nom. Écris « la HAS demande de… », jamais « faites… ». La fiche renvoie vers le texte de référence, elle ne s'y substitue pas.
- Style sobre et opérationnel. Le lecteur a 60 secondes.`;

export async function ficherReco(el, { modele, maxTokens = 8000, themes, effort, repli }) {
  const { sortie, usage } = await rediger({
    modele, maxTokens, effort, repli,
    systeme: SYSTEME_RECO,
    schema: avecThemes(SCHEMA_RECO, themes),
    contenu: `Publication à ficher.

ORGANISME : ${el.organisme ?? '—'}  (${el.sourceLabel ?? ''})
TITRE : ${el.titre}
DATE : ${el.date ?? 'non précisée'}
LIEN : ${el.lien ?? '—'}

TEXTE DISPONIBLE :
${el.resume || '(aucun texte au-delà du titre)'}

Rédige la fiche de cette publication.`,
  });
  return { fiche: bornerInteret(sortie), usage };
}

export async function ficherRecos(elements, { modele, maxTokens, concurrence = 3, onProgress, themes, effort, repli } = {}) {
  const out = new Array(elements.length);
  let curseur = 0, faits = 0;
  async function worker() {
    while (true) {
      const i = curseur++;
      if (i >= elements.length) return;
      try {
        const { fiche, usage } = await ficherReco(elements[i], { modele, maxTokens, themes, effort, repli });
        out[i] = { element: elements[i], fiche, usage };
      } catch (e) {
        out[i] = { element: elements[i], erreur: String(e.message ?? e) };
      }
      onProgress?.(++faits, elements.length, elements[i], out[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrence, elements.length) }, worker));
  // Les échecs sont rendus avec les réussites : c'est à l'appelant de décider
  // quoi en faire (les retenter, les compter, les afficher) — pas à cette file
  // de les faire disparaître.
  return out.filter(Boolean);
}

const SCHEMA_EDITO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titre: { type: 'string', description: 'Titre du jour, 6 à 10 mots, factuel.' },
    points: {
      type: 'array',
      items: { type: 'string' },
      description: "2 à 4 points, une phrase chacun, qui résument ce qu'il faut retenir de la journée. Cite la revue entre parenthèses.",
    },
    a_lire_en_priorite: { type: 'string', description: "Le titre français de l'article à lire en premier, et pourquoi en une demi-phrase." },
  },
  required: ['titre', 'points', 'a_lire_en_priorite'],
};

export async function redigerEdito(fiches, { modele, maxTokens = 8000, recos = [], effort, repli }) {
  const resume = fiches
    .map((f, i) => `${i + 1}. [${f.fiche.theme} — ${f.article.journalAbrege || f.article.journal} — intérêt ${f.fiche.interet}/5] ${f.fiche.titre_fr} — ${f.fiche.accroche}`)
    .join('\n');

  const bloqueRecos = recos.length
    ? '\n\nRECOMMANDATIONS FRANÇAISES parues (à mentionner en priorité, elles priment sur les articles) :\n' +
      recos.map((r, i) => `R${i + 1}. [${r.fiche.type} ${r.element.organisme} — intérêt ${r.fiche.interet}/5] ${r.fiche.titre_court} — ${r.fiche.accroche}`).join('\n')
    : '';

  const { sortie, usage } = await rediger({
    modele, maxTokens, effort, repli,
    systeme: SYSTEME,
    schema: SCHEMA_EDITO,
    contenu: `Voici les articles fichés aujourd'hui :\n\n${resume}${bloqueRecos}\n\nRédige l'édito du jour. Sois sélectif : ne retiens que ce qui mérite l'attention. S'il y a une recommandation française, elle ouvre l'édito.`,
  });
  return { edito: sortie, usage };
}

/** Fiche une liste d'articles avec une petite file de concurrence. */
export async function ficherTous(articles, { modele, maxTokens, concurrence = 4, onProgress, themes, effort, repli } = {}) {
  const resultats = new Array(articles.length);
  let curseur = 0;
  let faits = 0;

  async function worker() {
    while (true) {
      const i = curseur++;
      if (i >= articles.length) return;
      const article = articles[i];
      try {
        const { fiche, usage } = await ficher(article, { modele, maxTokens, themes, effort, repli });
        resultats[i] = { article, fiche, usage };
      } catch (e) {
        resultats[i] = { article, erreur: String(e.message ?? e) };
      }
      faits++;
      onProgress?.(faits, articles.length, article, resultats[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrence, articles.length) }, worker));
  // Même contrat que ficherRecos : les échecs sont rendus, pas avalés.
  return resultats.filter(Boolean);
}
