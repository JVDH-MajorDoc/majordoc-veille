#!/usr/bin/env node
// MajorDoc — diagnostic des sources internationales (Europe PMC).
//
//   node src/diagnostic.mjs           analyse la configuration actuelle
//   node src/diagnostic.mjs --jours 7 teste une autre fenêtre
//
// À lancer quand le board affiche « 0 retenus sur 0 » : cet outil décompose
// chaque requête couche par couche et dit laquelle ramène le compte à zéro.
//
// Pourquoi c'est utile. Le pied de page ne montre qu'un total. Or une requête
// Europe PMC est un empilement — sujet, type de publication, filtre de date,
// présence d'un résumé — et n'importe lequel de ces étages peut vider le
// résultat sans provoquer d'erreur. L'API répond 200 avec zéro résultat, ce
// qui est indiscernable d'« il n'y a rien eu de publié » à la lecture du board.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { preparerSources, sujetDepuisThemes, TROP_GENERIQUES } from './vocabulaire.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const UA = 'MajorDoc/1.0 (veille bibliographique personnelle)';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

/** Ne demande qu'un compteur : pageSize=1, resultType=idlist. Réponse minuscule. */
async function combien(query) {
  const params = new URLSearchParams({ query, format: 'json', resultType: 'idlist', pageSize: '1' });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(`${BASE}?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!r.ok) return { erreur: `HTTP ${r.status} ${r.statusText}` };
    const d = await r.json();
    return { n: Number(d?.hitCount ?? 0) };
  } catch (e) {
    return { erreur: String(e.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

function isoDay(offset = 0) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

const pad = (s, n) => String(s).padEnd(n);
function ligne(label, r) {
  const v = r.erreur ? `erreur : ${r.erreur}` : r.n.toLocaleString('fr-FR');
  console.log(`     ${pad(label, 46)} ${v}`);
}

// ---------------------------------------------------------------------------
// Mode --champs : quel nom de champ Europe PMC reconnaît-il réellement ?
//
// Une requête qui vise un champ inexistant ne provoque pas d'erreur : Europe PMC
// répond 200 et retombe sur une recherche en texte libre, qui ramène quelques
// résultats au lieu de quelques centaines de milliers. Le compteur est donc le
// seul témoin. Un champ valide sur un terme MeSH courant doit se compter en
// dizaines ou centaines de milliers ; tout ce qui est en dessous est un leurre.
// ---------------------------------------------------------------------------

const MESH_ENDOC = [
  'Endocrine System Diseases', 'Diabetes Mellitus', 'Thyroid Diseases',
  'Adrenal Gland Diseases', 'Pituitary Diseases', 'Bone Diseases, Metabolic',
  'Obesity', 'Gonadal Disorders',
];

const SUJET_TEXTE =
  '(TITLE_ABS:diabet* OR TITLE_ABS:thyroid* OR TITLE_ABS:endocrin* OR TITLE_ABS:obesity ' +
  'OR TITLE_ABS:obese OR TITLE_ABS:osteoporo* OR TITLE_ABS:adrenal OR TITLE_ABS:pituitary ' +
  'OR TITLE_ABS:insulin OR TITLE_ABS:"GLP-1" OR TITLE_ABS:hypogonadism ' +
  'OR TITLE_ABS:"metabolic syndrome" OR TITLE_ABS:hyperparathyroid* OR TITLE_ABS:hypoparathyroid* ' +
  'OR TITLE_ABS:glycaemic OR TITLE_ABS:glycemic OR TITLE_ABS:HbA1c OR TITLE_ABS:"vitamin D")';

const TYPES =
  '(PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Meta-Analysis" ' +
  'OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Guideline")';

const bloc = (champ) => '(' + MESH_ENDOC.map((t) => `${champ}:"${t}"`).join(' OR ') + ')';

async function champs() {
  console.log('\n  MajorDoc — quelle syntaxe Europe PMC reconnaît-il ?\n');

  console.log('  1. Champ « sujet », testé sur un terme MeSH très courant');
  console.log('     (un champ valide doit se compter en centaines de milliers)\n');
  for (const c of ['MESH', 'MESH_TERMS', 'MESHTERMS', 'MESH_MAJOR_TOPIC', 'KW', 'TITLE_ABS']) {
    ligne(`${c}:"Diabetes Mellitus"`, await combien(`${c}:"Diabetes Mellitus"`));
  }
  ligne('texte libre "diabetes mellitus"', await combien('"diabetes mellitus"'));
  console.log('');

  console.log('  2. Type de publication et langue\n');
  for (const q of [
    'PUB_TYPE:"Randomized Controlled Trial"',
    'PUB_TYPE:"randomized controlled trial"',
    'PUB_TYPE:"Meta-Analysis"',
    'PUB_TYPE:"Guideline"',
    'LANG:eng',
    'LANG:fre',
  ]) ligne(q, await combien(q));
  console.log('');

  // Les deux requêtes en panne, réécrites de trois façons, mesurées côte à côte.
  console.log('  3. Réécritures candidates, mesurées sans filtre de date\n');
  const candidats = [
    ['essais — actuel  MESH + PUB_TYPE', `${bloc('MESH')} AND ${TYPES}`],
    ['essais — MESH_TERMS + PUB_TYPE', `${bloc('MESH_TERMS')} AND ${TYPES}`],
    ['essais — sujet en texte + PUB_TYPE', `${SUJET_TEXTE} AND ${TYPES}`],
    ['large — actuel  MESH + LANG', `${bloc('MESH')} AND (LANG:eng OR LANG:fre)`],
    ['large — MESH_TERMS + LANG', `${bloc('MESH_TERMS')} AND (LANG:eng OR LANG:fre)`],
    ['large — sujet en texte + LANG', `${SUJET_TEXTE} AND (LANG:eng OR LANG:fre)`],
  ];
  for (const [label, q] of candidats) ligne(label, await combien(q));
  console.log('');

  // Et les mêmes, sur la fenêtre réelle : c'est ce chiffre-là qui atterrira
  // sur le board demain matin.
  const fin = isoDay(0);
  const deb = isoDay(-(Number(arg('--jours')) || 4));
  console.log(`  4. Les mêmes sur la fenêtre ${deb} → ${fin}, datées sur FIRST_IDATE\n`);
  for (const [label, q] of candidats) {
    ligne(label, await combien(`(${q}) AND FIRST_IDATE:[${deb} TO ${fin}] AND (SRC:MED OR SRC:PMC) AND HAS_ABSTRACT:Y`));
  }
  console.log('\n  Collez cette sortie telle quelle : elle suffit à choisir la bonne requête.\n');
}

// ---------------------------------------------------------------------------
// Mode --couverture : la spécialité est-elle réellement couverte ?
//
// Le board sait ranger une fiche dans huit thèmes. Encore faut-il que la requête
// puisse en trouver. Ce mode mesure, thème par thème, ce que le vocabulaire
// ramène sur la fenêtre — et surtout ce que l'ancienne requête laissait passer.
// ---------------------------------------------------------------------------

async function couverture() {
  const config = JSON.parse(await readFile(path.join(RACINE, 'config.json'), 'utf8'));
  const { sujet, termes, ecartes } = sujetDepuisThemes(config.themes);
  const fenetre = Number(arg('--jours')) || config.fenetre_jours || 4;
  const fin = isoDay(0);
  const deb = isoDay(-fenetre);
  const cadre = (q) => `(${q}) AND FIRST_IDATE:[${deb} TO ${fin}] AND (SRC:MED OR SRC:PMC) AND HAS_ABSTRACT:Y`;

  console.log(`\n  MajorDoc — couverture de la spécialité`);
  console.log(`  Fenêtre ${deb} → ${fin} · ${termes} termes cherchés\n`);

  console.log('  1. La requête complète passe-t-elle ?\n');
  ligne(`nouvelle requête (${sujet.length} caractères)`, await combien(cadre(sujet)));
  ligne('ancienne requête (18 termes)', await combien(cadre(SUJET_TEXTE)));
  console.log('');

  console.log('  2. Par thème : trouvé sur la fenêtre, et ce que l\'ancienne ratait\n');
  console.log(`     ${pad('thème', 26)} ${pad('trouvé', 9)} manqué par l'ancienne`);
  for (const [nom, mots] of Object.entries(config.themes ?? {})) {
    const utiles = (mots ?? []).filter((m) => !TROP_GENERIQUES.has(String(m).toLowerCase()));
    if (!utiles.length) continue;
    const bloc = '(' + utiles.map((m) => (/[\s'-]/.test(m) ? `TITLE_ABS:"${m}"` : `TITLE_ABS:${m}*`)).join(' OR ') + ')';
    const total = await combien(cadre(bloc));
    const rate = await combien(cadre(`${bloc} NOT ${SUJET_TEXTE}`));
    const a = total.erreur ? total.erreur : total.n.toLocaleString('fr-FR');
    const b = rate.erreur ? '—' : rate.n.toLocaleString('fr-FR');
    console.log(`     ${pad(nom, 26)} ${pad(a, 9)} ${b}`);
  }
  console.log('');

  if (ecartes.length) {
    console.log('  3. Termes gardés pour le classement, écartés de la recherche\n');
    for (const m of ecartes) console.log(`     ${pad(m, 14)} ${TROP_GENERIQUES.get(m)}`);
    console.log('');
  }

  console.log('  Si un thème affiche 0 trouvé, son vocabulaire est à revoir dans');
  console.log('  config.json → themes. Tout terme ajouté sert aussitôt à chercher.\n');
}

async function main() {
  if (process.argv.includes('--champs')) return champs();
  if (process.argv.includes('--couverture')) return couverture();
  const config = JSON.parse(await readFile(path.join(RACINE, 'config.json'), 'utf8'));
  preparerSources(config);
  const fenetre = Number(arg('--jours')) || config.fenetre_jours || 4;
  const fin = isoDay(0);
  const debut = isoDay(-fenetre);

  console.log(`\n  MajorDoc — diagnostic Europe PMC`);
  console.log(`  Fenêtre testée : ${debut} → ${fin}  (${fenetre} jours)\n`);

  // ---------------------------------------------------------------- étage 1
  // L'API répond-elle, et quel champ de date décrit vraiment « ce qui est
  // nouveau » ? FIRST_PDATE est la date de publication imprimée par la revue ;
  // elle peut être vieille de plusieurs semaines le jour où Europe PMC indexe
  // l'article. FIRST_IDATE et CREATION_DATE décrivent l'entrée dans l'index.
  // Si le premier est à zéro et les autres à plusieurs milliers, la veille
  // interroge la mauvaise horloge.
  console.log('  1. L\'API répond-elle, et quel champ de date suivre ?\n');
  ligne('toute la base (contrôle de vie)', await combien('MESH:"Diabetes Mellitus"'));
  for (const champ of ['FIRST_PDATE', 'FIRST_IDATE', 'CREATION_DATE']) {
    ligne(`tout MEDLINE sur la fenêtre · ${champ}`, await combien(`${champ}:[${debut} TO ${fin}] AND SRC:MED`));
  }
  console.log('');

  // ---------------------------------------------------------------- étage 2
  // Chaque source, décomposée. On ajoute une contrainte à la fois : le premier
  // palier qui tombe à zéro est le coupable.
  console.log('  2. Chaque source, contrainte par contrainte\n');
  const champDefaut = config.champ_date ?? 'FIRST_PDATE';
  const verdicts = [];

  for (const source of config.sources ?? []) {
    const f = source.fenetre_jours ?? fenetre;
    const d = isoDay(-f);
    const champ = source.champ_date ?? champDefaut;
    console.log(`  ${source.label}   (${f} j · ${champ})`);

    const sujet = await combien(`(${source.query})`);
    ligne('sujet seul, sans filtre de date', sujet);

    const dateActuelle = await combien(`(${source.query}) AND ${champ}:[${d} TO ${fin}]`);
    ligne(`+ fenêtre sur ${champ}`, dateActuelle);

    const complet = await combien(
      `(${source.query}) AND ${champ}:[${d} TO ${fin}] AND (SRC:MED OR SRC:PMC) AND HAS_ABSTRACT:Y`
    );
    ligne('+ source MED/PMC + résumé présent  ← requête réelle', complet);

    // Le même sujet, mais daté sur l'entrée dans l'index plutôt que sur la
    // date de publication de la revue. C'est la comparaison qui tranche.
    const alt = await combien(
      `(${source.query}) AND FIRST_IDATE:[${d} TO ${fin}] AND (SRC:MED OR SRC:PMC) AND HAS_ABSTRACT:Y`
    );
    ligne('la même, datée sur FIRST_IDATE', alt);

    verdicts.push({ source, sujet, dateActuelle, complet, alt, champ });
    console.log('');
  }

  // ---------------------------------------------------------------- verdict
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  Lecture\n');

  for (const v of verdicts) {
    const nom = v.source.label;
    if (v.sujet.erreur || v.complet.erreur) {
      console.log(`  ✗ ${nom} : l'API refuse la requête (${v.sujet.erreur ?? v.complet.erreur}).`);
      console.log('    La syntaxe de la requête est probablement en cause.\n');
      continue;
    }
    if (v.sujet.n === 0) {
      console.log(`  ✗ ${nom} : le sujet lui-même ne ramène rien, même sans filtre de date.`);
      console.log('    Un champ de la requête n\'est plus reconnu par Europe PMC.\n');
      continue;
    }
    if (v.complet.n > 0) {
      console.log(`  ✓ ${nom} : ${v.complet.n} article(s) sur la fenêtre. Cette source fonctionne.\n`);
      continue;
    }
    if (!v.alt.erreur && v.alt.n > 0) {
      console.log(`  ! ${nom} : 0 sur ${v.champ}, mais ${v.alt.n} sur FIRST_IDATE.`);
      console.log('    La requête suit la date de publication de la revue, pas la date');
      console.log('    d\'entrée dans l\'index. Corriger avec, dans config.json :');
      console.log('      "champ_date": "FIRST_IDATE"\n');
      continue;
    }
    console.log(`  ! ${nom} : 0 quel que soit le champ de date.`);
    console.log(`    Le sujet existe (${v.sujet.n.toLocaleString('fr-FR')} articles au total) mais rien`);
    console.log('    sur la fenêtre. Élargir : node src/diagnostic.mjs --jours 14\n');
  }
}

main().catch((e) => { console.error(`\n  Erreur : ${e.message}\n`); process.exitCode = 1; });
