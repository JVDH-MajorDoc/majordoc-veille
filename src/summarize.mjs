// MajorDoc — résumés structurés en français via l'API Claude.
// Sortie garantie par "tool use" : le modèle doit remplir un schéma, pas
// produire du JSON libre. Zéro parsing hasardeux.

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

async function appel(chemin, body, { essais = 3 } = {}) {
  let derniereErreur;
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(`${API}${chemin}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'x-api-key': cle(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!r.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${r.status}`), { fatal: r.status < 500 && r.status !== 429 });
      return data;
    } catch (e) {
      derniereErreur = e;
      if (e.fatal) break;
      await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
    }
  }
  throw derniereErreur;
}

/** Vérifie que le modèle configuré existe ; sinon retombe sur le Sonnet le plus récent. */
export async function resoudreModele(souhaite) {
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

/** Rebranche l'énumération des thèmes d'un outil sur la liste du config. */
export function avecThemes(outil, themes) {
  if (!themes?.length) return outil;
  const liste = [...themes.filter((t) => t !== 'Autre'), 'Autre'];
  return {
    ...outil,
    input_schema: {
      ...outil.input_schema,
      properties: { ...outil.input_schema.properties, theme: { type: 'string', enum: liste } },
    },
  };
}

const OUTIL_FICHE = {
  name: 'fiche_article',
  description: "Enregistre la fiche de lecture structurée d'un article scientifique.",
  input_schema: {
    type: 'object',
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
        minimum: 1,
        maximum: 5,
        description:
          "Intérêt clinique pour un endocrinologue français. 5 = change la pratique ou une reco. 3 = bon à savoir. 1 = anecdotique / très spécialisé.",
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
  },
};

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

Remplis la fiche avec l'outil fiche_article.`;
}

export async function ficher(article, { modele, maxTokens = 1600, themes }) {
  const data = await appel('/messages', {
    model: modele,
    max_tokens: maxTokens,
    system: SYSTEME,
    tools: [avecThemes(OUTIL_FICHE, themes)],
    tool_choice: { type: 'tool', name: 'fiche_article' },
    messages: [{ role: 'user', content: prompt(article) }],
  });
  const bloc = (data.content ?? []).find((c) => c.type === 'tool_use');
  if (!bloc) throw new Error('Réponse sans fiche exploitable');
  return { fiche: decoderEchappements(bloc.input), usage: data.usage ?? {} };
}

/* --------------------------------------------------------------------------
   Recommandations françaises (HAS, SFE, SFD…)
   Texte déjà en français : pas de traduction, l'enjeu est « qu'est-ce qui change ».
   -------------------------------------------------------------------------- */

const OUTIL_RECO = {
  name: 'fiche_reco',
  description: "Enregistre la fiche d'une recommandation ou d'une publication d'organisme français.",
  input_schema: {
    type: 'object',
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
      interet: { type: 'integer', minimum: 1, maximum: 5, description: "Intérêt pour la pratique d'un endocrinologue français. 5 = texte opposable." },
      certitude: {
        type: 'string',
        enum: ['Texte complet lu', 'Résumé seul', 'Titre seul'],
        description: "Honnêteté sur la matière disponible : si seul le titre était fourni, le dire.",
      },
    },
    required: ['titre_court', 'accroche', 'ce_qui_change', 'points_cles', 'population', 'pour_la_pratique', 'type', 'theme', 'interet', 'certitude'],
  },
};

const SYSTEME_RECO = `Tu es un endocrinologue-diabétologue français qui dépouille les publications des organismes officiels (HAS, SFE, SFD) pour ses confrères.

Règles absolues :
- Le texte fourni est déjà en français : tu ne traduis pas, tu synthétises.
- Tu es FIDÈLE au texte fourni. Tu n'inventes aucune recommandation, aucun seuil, aucun chiffre. Si le texte disponible est mince, tu remplis « certitude » en conséquence et tu restes prudent plutôt que d'extrapoler.
- Une recommandation n'est pas une nouveauté par principe : beaucoup de publications sont des actualisations mineures. Dis-le quand c'est le cas, dans « ce_qui_change ».
- Tu distingues ce qui est opposable (recommandation de bonne pratique, avis officiel) de ce qui est indicatif (position de société savante, actualité).
- Tu rapportes ce que le texte dit ; tu ne prescris jamais en ton nom. Écris « la HAS demande de… », jamais « faites… ». La fiche renvoie vers le texte de référence, elle ne s'y substitue pas.
- Style sobre et opérationnel. Le lecteur a 60 secondes.`;

export async function ficherReco(el, { modele, maxTokens = 1400, themes }) {
  const data = await appel('/messages', {
    model: modele,
    max_tokens: maxTokens,
    system: SYSTEME_RECO,
    tools: [avecThemes(OUTIL_RECO, themes)],
    tool_choice: { type: 'tool', name: 'fiche_reco' },
    messages: [
      {
        role: 'user',
        content: `Publication à ficher.

ORGANISME : ${el.organisme ?? '—'}  (${el.sourceLabel ?? ''})
TITRE : ${el.titre}
DATE : ${el.date ?? 'non précisée'}
LIEN : ${el.lien ?? '—'}

TEXTE DISPONIBLE :
${el.resume || '(aucun texte au-delà du titre)'}

Remplis la fiche avec l'outil fiche_reco.`,
      },
    ],
  });
  const bloc = (data.content ?? []).find((c) => c.type === 'tool_use');
  if (!bloc) throw new Error('Réponse sans fiche exploitable');
  return { fiche: decoderEchappements(bloc.input), usage: data.usage ?? {} };
}

export async function ficherRecos(elements, { modele, maxTokens, concurrence = 3, onProgress, themes } = {}) {
  const out = new Array(elements.length);
  let curseur = 0, faits = 0;
  async function worker() {
    while (true) {
      const i = curseur++;
      if (i >= elements.length) return;
      try {
        const { fiche, usage } = await ficherReco(elements[i], { modele, maxTokens, themes });
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

const OUTIL_EDITO = {
  name: 'edito',
  description: "Rédige l'édito du jour à partir des fiches.",
  input_schema: {
    type: 'object',
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
  },
};

export async function redigerEdito(fiches, { modele, maxTokens = 900, recos = [] }) {
  const resume = fiches
    .map((f, i) => `${i + 1}. [${f.fiche.theme} — ${f.article.journalAbrege || f.article.journal} — intérêt ${f.fiche.interet}/5] ${f.fiche.titre_fr} — ${f.fiche.accroche}`)
    .join('\n');

  const bloqueRecos = recos.length
    ? '\n\nRECOMMANDATIONS FRANÇAISES parues (à mentionner en priorité, elles priment sur les articles) :\n' +
      recos.map((r, i) => `R${i + 1}. [${r.fiche.type} ${r.element.organisme} — intérêt ${r.fiche.interet}/5] ${r.fiche.titre_court} — ${r.fiche.accroche}`).join('\n')
    : '';

  const data = await appel('/messages', {
    model: modele,
    max_tokens: maxTokens,
    system: SYSTEME,
    tools: [OUTIL_EDITO],
    tool_choice: { type: 'tool', name: 'edito' },
    messages: [
      {
        role: 'user',
        content: `Voici les articles fichés aujourd'hui :\n\n${resume}${bloqueRecos}\n\nRédige l'édito du jour avec l'outil edito. Sois sélectif : ne retiens que ce qui mérite l'attention. S'il y a une recommandation française, elle ouvre l'édito.`,
      },
    ],
  });
  const bloc = (data.content ?? []).find((c) => c.type === 'tool_use');
  if (!bloc) throw new Error('Édito non généré');
  return { edito: bloc.input, usage: data.usage ?? {} };
}

/** Fiche une liste d'articles avec une petite file de concurrence. */
export async function ficherTous(articles, { modele, maxTokens, concurrence = 4, onProgress, themes } = {}) {
  const resultats = new Array(articles.length);
  let curseur = 0;
  let faits = 0;

  async function worker() {
    while (true) {
      const i = curseur++;
      if (i >= articles.length) return;
      const article = articles[i];
      try {
        const { fiche, usage } = await ficher(article, { modele, maxTokens, themes });
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
