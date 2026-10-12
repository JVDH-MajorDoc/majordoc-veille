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
// Une espace ne sépare des milliers que devant trois chiffres exactement :
// sans cette règle, « Ki-67 30 % » se lisait « 6 730 ».
const JETON = /-?\d+(?:[.,]\d+|[\u00a0 ]\d{3}(?!\d))*/g;

/** Un groupe de milliers ne commence jamais par zéro : « 0,001 » n'en est pas un. */
const MILLIERS = /^-?(?!0\d*[,\u00a0 ])\d{1,3}(?:[,\u00a0 ]\d{3})+$/;

/**
 * Les écritures qui faisaient crier le filet pour rien, relevées sur les fiches
 * du 5 au 12 octobre 2026 (48 fiches sur 90 signalées, presque toutes à tort) :
 * le point médian du Lancet (« 1·06 »), la décimale sans zéro du style APA
 * (« β = -.095 »), les dates (« 22/09/2025 ») et les énumérations (« (3) »).
 */
function unifier(texte) {
  return String(texte ?? '')
    .replace(/[\u2212\u2013\u2014\u2012]/g, '-')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/(\d)\u00b7(\d)/g, '$1.$2')
    .replace(/(^|[^\d.,])\.(\d)/g, (_, avant, chiffre) => `${avant}0.${chiffre}`)
    .replace(/\b(?:\d{1,2}\/)?\d{1,2}\/\d{4}\b/g, ' ')
    .replace(/\(\d\)/g, ' ');
}

function estAnnee(n, lectures) {
  const a = Math.abs(n); // « 2006-2019 » : le trait d'union n'est pas un signe moins
  return Number.isInteger(a) && a >= 1900 && a <= 2100 && lectures.every((l) => l.decimales === 0);
}

/**
 * Un nombre collé à des lettres fait partie d'un nom, pas d'un résultat :
 * IC95, Ki-67, HbA1c, I2, DT2, NNC0385-0434. On remonte la suite de chiffres
 * et de tirets qui le précède : si elle part d'une lettre, il est ignoré.
 */
function estDansUnNom(texte, index) {
  let i = index - 1;
  while (i >= 0 && /[\d.,-]/.test(texte[i])) i--;
  return i >= 0 && /\p{L}/u.test(texte[i]);
}

/**
 * « 6,07 M » face à « 6,070,000 » : l'échelle écrite en toutes lettres ou en
 * abrégé — y compris pour la borne basse d'un intervalle (« 2,23-14,29 M »).
 */
const ECHELLES = [
  [/^(?:\s?-\s?\d[\d.,]*)?\s?(?:millions?|M)\b/, 6],
  [/^(?:\s?-\s?\d[\d.,]*)?\s?(?:milliards?|Md|billions?)\b/, 9],
];

/** Les résumés écrivent souvent les petits effectifs en toutes lettres : « two trials ». */
const NOMBRES_EN = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const MOT_NOMBRE = new RegExp(String.raw`\b(${Object.keys(NOMBRES_EN).join('|')})\b`, 'gi');

function nombresEnLettres(texte) {
  return [...String(texte ?? '').matchAll(MOT_NOMBRE)].map((m) => ({
    brut: m[0], lectures: [{ valeur: NOMBRES_EN[m[1].toLowerCase()], decimales: 0 }],
  }));
}

/** @returns {{brut:string, lectures:{valeur:number, decimales:number}[]}[]} */
function extraire(texte) {
  const out = [];
  const t = unifier(texte);
  for (const m of t.matchAll(JETON)) {
    const brut = m[0];
    if (estDansUnNom(t, m.index)) continue;
    if (t.startsWith('(OH)', m.index + brut.length)) continue; // 25(OH)D
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
    // Une échelle qui suit (« 6,07 M ») ajoute la lecture à l'unité ; la
    // tolérance suit, puisque les décimales deviennent négatives.
    const suite = t.slice(m.index + brut.length, m.index + brut.length + 24);
    for (const [re, puissance] of ECHELLES) {
      if (!re.test(suite)) continue;
      for (const l of [...lectures]) {
        lectures.push({ valeur: l.valeur * 10 ** puissance, decimales: l.decimales - puissance });
      }
    }
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

  const source = [...extraire(texteSource), ...nombresEnLettres(texteSource)];
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
