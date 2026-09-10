// MajorDoc — contrôle des chiffres.
//
// Le prompt exige la fidélité au résumé source, mais rien ne le vérifiait.
// Or un intervalle de confiance inventé est indétectable à la lecture, et c'est
// exactement le genre de donnée qu'un médecin retient et cite.
//
// Principe : tout nombre présent dans la fiche doit se retrouver dans le résumé
// d'origine. On ne rejette rien — on signale, et le board affiche la mention.
// C'est un filet, pas un juge : mieux vaut une alerte de trop qu'un chiffre faux
// qui passe inaperçu.

/** Champs de la fiche susceptibles de porter des chiffres. */
const CHAMPS_ARTICLE = ['accroche', 'methode', 'resultats', 'conclusion', 'pour_la_pratique', 'limites'];
const CHAMPS_RECO = ['accroche', 'ce_qui_change', 'points_cles', 'population', 'pour_la_pratique'];

/**
 * Extraction des nombres.
 *
 * Le piège est la virgule : « 0,931 » est une décimale française, « 12,480 » un
 * millier anglais, et les deux se ressemblent. Plutôt que de trancher — ce qui
 * produisait des faux positifs en série sur les décimales à trois chiffres —
 * chaque nombre est lu dans TOUTES ses interprétations plausibles, et deux
 * nombres concordent dès qu'une lecture de l'un rejoint une lecture de l'autre.
 */
const JETON = /-?\d+(?:[.,\u00a0 ]\d+)*/g;

/** Un groupe de milliers ne commence jamais par zéro : « 0,001 » n'en est pas un. */
const MILLIERS = /^-?(?!0\d*[,\u00a0 ])\d{1,3}(?:[,\u00a0 ]\d{3})+$/;

function unifier(texte) {
  return String(texte ?? '').replace(/[\u2212\u2013\u2014\u2012]/g, '-').replace(/[\u00a0\u202f]/g, ' ');
}

function estAnnee(n, lectures) {
  return Number.isInteger(n) && n >= 1900 && n <= 2100 && lectures.every((l) => l.decimales === 0);
}

/** @returns {{brut:string, lectures:{valeur:number, decimales:number}[]}[]} */
function extraire(texte) {
  const out = [];
  for (const m of unifier(texte).matchAll(JETON)) {
    const brut = m[0];
    const lectures = [];
    const ajouter = (t) => {
      const v = Number(t);
      if (!Number.isFinite(v)) return;
      const dec = (t.split('.')[1] ?? '').length;
      if (!lectures.some((l) => l.valeur === v && l.decimales === dec)) lectures.push({ valeur: v, decimales: dec });
    };

    // 1. Lecture décimale : les espaces séparent les milliers, la virgule décime.
    ajouter(brut.replace(/ /g, '').replace(',', '.'));
    // 2. Lecture « milliers » : seulement si la forme s'y prête.
    if (MILLIERS.test(brut)) ajouter(brut.replace(/[,  ]/g, ''));

    if (!lectures.length) continue;
    if (estAnnee(lectures[0].valeur, lectures)) continue;
    out.push({ brut, lectures });
  }
  return out;
}

/**
 * Concordance : la comparaison porte sur la valeur absolue, à dessein.
 * L'abstract écrit « HbA1c fell by 2.1% » quand la fiche écrit « −2,1 % » —
 * le signe est porté par le verbe d'un côté, par le nombre de l'autre. Exiger
 * la concordance des signes déclencherait une alerte sur presque chaque fiche,
 * et un filet qui crie tout le temps ne protège plus de rien.
 * Contrepartie assumée : une inversion de signe seule n'est pas détectée.
 */
function retrouve(chiffre, source) {
  for (const l of chiffre.lectures) {
    const tol = 0.5 * Math.pow(10, -l.decimales);
    const cible = Math.abs(l.valeur);
    for (const s of source) {
      for (const ls of s.lectures) {
        const v = Math.abs(ls.valeur);
        if (Math.abs(v - cible) < tol) return true;
        // Un pourcentage écrit en fraction, ou l'inverse (0,62 ↔ 62 %)
        if (Math.abs(v - cible * 100) < tol * 100) return true;
        if (Math.abs(v * 100 - cible) < tol) return true;
      }
    }
  }
  return false;
}

function textesDe(fiche, champs) {
  const morceaux = [];
  for (const c of champs) {
    const v = fiche?.[c];
    if (Array.isArray(v)) morceaux.push(v.join(' '));
    else if (typeof v === 'string') morceaux.push(v);
  }
  return morceaux.join(' \n ');
}

/**
 * @returns {{controles:number, absents:string[]}} — `absents` liste les chiffres
 * de la fiche introuvables dans le texte source, dédoublonnés et dans l'ordre.
 */
export function verifierChiffres(fiche, texteSource, { type = 'article' } = {}) {
  const champs = type === 'reco' ? CHAMPS_RECO : CHAMPS_ARTICLE;
  const dansLaFiche = extraire(textesDe(fiche, champs));
  if (!dansLaFiche.length) return { controles: 0, absents: [] };

  const source = extraire(texteSource);
  const absents = [];
  for (const c of dansLaFiche) {
    if (retrouve(c, source)) continue;
    if (!absents.includes(c.brut)) absents.push(c.brut);
  }
  return { controles: dansLaFiche.length, absents };
}

/** Applique le contrôle à une liste de résultats et renvoie un récapitulatif. */
export function controler(resultats, { type = 'article' } = {}) {
  let signalees = 0;
  for (const r of resultats) {
    const source = type === 'reco' ? r.element?.resume : r.article?.resume;
    r.fiche.verif = verifierChiffres(r.fiche, source ?? '', { type });
    if (r.fiche.verif.absents.length) signalees++;
  }
  return { total: resultats.length, signalees };
}
