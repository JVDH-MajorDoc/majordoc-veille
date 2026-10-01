#!/usr/bin/env node
// MajorDoc — orchestrateur.
//
//   node src/run.mjs              veille du jour (nécessite ANTHROPIC_API_KEY)
//   node src/run.mjs --dry-run    récupère et classe, sans appel IA — gratuit
//   node src/run.mjs --demo       site d'exemple, hors ligne
//   node src/run.mjs --inline     produit en plus board.html autonome
//   node src/run.mjs --jours 7 --max 15 --out /chemin/du/site

import { readFile, writeFile, unlink, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recolter } from './fetch.mjs';
import { recolterRecos, enrichir } from './fr.mjs';
import { chargerRegistre, enregistrerRegistre, dejaVuArticle, marquerArticles, compter } from './registre.mjs';
import { classer, selectionner } from './rank.mjs';
import { ficherTous, ficherRecos, redigerEdito, resoudreModele } from './summarize.mjs';
import { construire, fabriquerDigest, aplatir, aplatirRecos } from './build.mjs';
import { controler } from './verif.mjs';
import { synthetiser } from './voix.mjs';
import { notifierEdito } from './notifier.mjs';
import { DIGEST_DEMO } from './demo.mjs';
import { preparerSources, themeOfficiel } from './vocabulaire.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function chargerEnv() {
  const f = path.join(RACINE, '.env');
  if (!existsSync(f)) return;
  for (const ligne of (await readFile(f, 'utf8')).split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function args() {
  const a = process.argv.slice(2);
  const v = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  return {
    dryRun: a.includes('--dry-run'),
    demo: a.includes('--demo'),
    inline: a.includes('--inline'),
    sansRecos: a.includes('--sans-recos'),
    oublier: a.includes('--oublier'),
    jours: Number(v('--jours')) || null,
    max: Number(v('--max')) || null,
    sortie: v('--out'),
    audit: a.includes('--audit') ? (Number(v('--audit')) || 40) : null,
  };
}

/**
 * Met par écrit ce que la sélection du jour a retenu et ce qu'elle a laissé
 * juste derrière. Le format vise la lecture par un médecin, pas par moi :
 * pas de score en tête de ligne, le titre d'abord, la limite bien visible.
 */
function redigerAudit(fiches, suivants, totalCandidats) {
  const jour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const l = [];
  l.push(`# MajorDoc — où passe la limite, ${jour}`, '');
  l.push(`${totalCandidats.toLocaleString('fr-FR')} articles ont été examinés ce matin. ${fiches.length} ont reçu une fiche.`);
  l.push(`Voici ces ${fiches.length}, puis les ${suivants.length} qui les suivaient immédiatement.`, '');
  l.push('**La question posée :** dans la seconde liste, y en a-t-il que vous auriez voulu lire ?', '');

  const ligne = (a, i) => {
    l.push(`${String(i + 1).padStart(2)}. **${a.titre}**`);
    l.push(`    ${a.journalAbrege || a.journal} · ${a.typeEtude} · ${a.theme} · ${a.date ?? 'date inconnue'}`);
    if (a.liens?.pubmed) l.push(`    ${a.liens.pubmed}`);
    l.push('');
  };

  l.push(`## Fichés ce matin`, '');
  fiches.forEach(ligne);
  l.push('---', '', `## Écartés de peu`, '');
  suivants.forEach((a, i) => ligne(a, i + fiches.length));
  return l.join('\n');
}

const VERROU = path.join(RACINE, 'data', 'run.lock');
let verrouPose = false;

/**
 * Deux générations simultanées — un lancement manuel pendant le passage du
 * timer — écriraient le registre et le site en même temps. Le verrou fait
 * échouer la seconde franchement plutôt que de laisser les écritures se
 * croiser en silence. Un verrou de plus de 30 minutes est le reste d'un
 * processus mort (le service est plafonné à 15 minutes) : on passe outre.
 */
async function poserVerrou() {
  await mkdir(path.dirname(VERROU), { recursive: true });
  try {
    await writeFile(VERROU, String(process.pid), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const age = Date.now() - (await stat(VERROU)).mtimeMs;
    if (age < 30 * 60000) {
      throw new Error('une génération est déjà en cours (verrou data/run.lock posé il y a ' +
        Math.max(1, Math.round(age / 60000)) + ' min). Attendez-la, ou supprimez ce fichier si elle est morte.');
    }
    await writeFile(VERROU, String(process.pid));
  }
  verrouPose = true;
}
async function lacherVerrou() {
  if (verrouPose) await unlink(VERROU).catch(() => {});
  verrouPose = false;
}

// Un Ctrl-C ou un arrêt systemd ne passe pas par finally : on libère le
// verrou nous-mêmes avant de rendre la main au signal.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    lacherVerrou().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

/**
 * File de fiches avec reprise : ce qui échoue au premier passage (rate limit,
 * réseau) est retenté une fois, plus calmement — en série. Ce qui échoue
 * encore est rendu, compté et affiché sur le board, jamais caché. Les
 * articles concernés ne sont pas marqués au registre : ils se représenteront
 * d'eux-mêmes au passage suivant.
 */
/** Les raisons d'échec, regroupées : quinze fois la même ligne ne dit rien de plus. */
function direRaisons(rates) {
  const n = new Map();
  for (const r of rates) n.set(r.erreur, (n.get(r.erreur) ?? 0) + 1);
  for (const [raison, k] of n) console.warn(`    Raison${k > 1 ? ` (${k} fiches)` : ''} : ${raison}`);
}

async function avecReprise(faire, elements, options) {
  const premier = await faire(elements, options);
  let ok = premier.filter((r) => !r.erreur);
  let rates = premier.filter((r) => r.erreur);
  if (rates.length) {
    console.log(`\n  ${rates.length} fiche(s) en échec :`);
    direRaisons(rates);
    console.log('  Seconde tentative, en série…');
    const seconde = await faire(rates.map((r) => r.article ?? r.element), { ...options, concurrence: 1 });
    ok = ok.concat(seconde.filter((r) => !r.erreur));
    rates = seconde.filter((r) => r.erreur);
    for (const r of rates) {
      console.warn(`  ✗ définitivement en échec : ${String((r.article ?? r.element)?.titre ?? '?').slice(0, 84)}`);
    }
    if (rates.length) direRaisons(rates);
  }
  return { ok, rates };
}

const t0 = Date.now();
const chrono = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

async function main() {
  await chargerEnv();
  const o = args();
  const config = JSON.parse(await readFile(path.join(RACINE, 'config.json'), 'utf8'));
  if (o.jours) config.fenetre_jours = o.jours;
  if (o.max) config.max_articles_resumes = o.max;

  // Les sources qui déclarent `"sujet": "themes"` tirent leur requête du
  // vocabulaire de la spécialité — une seule liste pour chercher et pour classer.
  const voc = preparerSources(config);

  console.log(`\n  MajorDoc — ${config.specialite}`);
  console.log(`  Vocabulaire : ${voc.termes} termes cherchés${voc.ecartes.length ? `, ${voc.ecartes.length} écartés comme trop génériques` : ''}\n`);

  if (o.demo) {
    const demo = DIGEST_DEMO(config);
    // La démo fabrique aussi l'audio quand la voix est active : c'est le moyen
    // d'éprouver Piper et d'entendre le résultat sans dépenser un seul jeton.
    const siteDemo = o.sortie ?? path.join(RACINE, 'site');
    await synthetiser({
      fiches: [
        ...demo.recos.map((f) => ({ fiche: f, type: 'reco' })),
        ...demo.articles.map((f) => ({ fiche: f, type: 'article' })),
      ],
      dossier: path.join(siteDemo, 'data', 'audio', demo.date),
      cheminRelatif: `data/audio/${demo.date}`,
      config, racine: RACINE,
    });
    const r = await construire({
      racine: RACINE, digest: demo, sortie: o.sortie, inline: o.inline,
      retentionAudio: config.voix?.retention_jours ?? 7,
    });
    console.log(`  Site de démonstration : ${r.site}`);
    console.log(`  Ouvrir avec : npm run preview\n`);
    return;
  }

  // Sans clé, autant le dire avant de récolter pendant une minute pour rien.
  if (!o.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("  Clé API manquante : renseignez ANTHROPIC_API_KEY dans .env (cf. INSTALLATION.md).\n");
    process.exitCode = 1;
    return;
  }

  // Le verrou ne concerne que les passages réels : --dry-run et --demo
  // n'écrivent ni le registre ni le site de production.
  if (!o.dryRun) await poserVerrou();

  // Registre des publications déjà fichées — recommandations et articles.
  let registre = await chargerRegistre(RACINE);
  if (o.oublier) {
    const n = compter(registre);
    registre = { vus: {}, articles: {} };
    console.log(`  --oublier : ${n.recos} recommandation(s) et ${n.articles} article(s) effacés du registre.\n`);
  }

  // 1. Recommandations françaises — elles priment, et elles sont peu nombreuses
  let recosBrutes = [], journalFr = [];
  if (!o.sansRecos && (config.sources_fr ?? []).length) {
    console.log('  Recommandations françaises…');
    ({ recos: recosBrutes, journal: journalFr } = await recolterRecos(config, { racine: RACINE, registre }));
    recosBrutes = recosBrutes
      .sort((a, b) => (b.poids ?? 0) - (a.poids ?? 0) || (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, config.max_recos_resumees ?? 6);
    for (const el of recosBrutes) await enrichir(el);
    console.log('');
  }

  // 2. Littérature internationale
  console.log(`  Récupération sur ${config.fenetre_jours} jours…`);
  const { articles, journal } = await recolter(config);

  // Même distinction qu'en aval, mais à la récolte : « les sources répondent
  // et n'ont rien de neuf » est un jour normal, « toutes les sources sont en
  // panne » est un incident. Sans ce partage, une semaine creuse suffisait à
  // faire sortir le service en erreur et le board n'était plus republié.
  const enPanne = journal.filter((j) => j.erreur);
  if (journal.length && enPanne.length === journal.length) {
    console.error(`\n  Les ${journal.length} sources internationales sont toutes en erreur — le board n'est pas republié.`);
    for (const j of enPanne) console.error(`    ${j.label} : ${j.erreur}`);
    console.error('');
    process.exitCode = 1;
    return;
  }
  if (!articles.length && !recosBrutes.length) {
    console.log('\n  Les sources répondent, mais aucune publication sur la fenêtre.');
    console.log('  Diagnostic des requêtes : node src/diagnostic.mjs');
    console.log(`  Fenêtre plus large : --jours ${(config.fenetre_jours ?? 4) * 2}`);
  }

  const classes = classer(articles, config);

  // Un article reste plusieurs jours dans la fenêtre glissante : sans ce filtre,
  // le même essai serait refiché — donc repayé — trois matins de suite.
  const inedits = classes.filter((a) => !dejaVuArticle(registre, a));
  const revus = classes.length - inedits.length;

  const retenus = selectionner(inedits, {
    max: config.max_articles_resumes,
    maxParTheme: config.max_par_theme ?? 5,
    maxParRevue: config.max_par_revue ?? 2,
  });
  console.log(`\n  ${articles.length} articles uniques` +
    (revus ? ` · ${revus} déjà fiché(s) les jours précédents` : '') +
    ` → ${retenus.length} retenus  (${chrono()})`);

  if (o.dryRun) {
    if (recosBrutes.length) {
      console.log('\n  Recommandations françaises retenues :\n');
      recosBrutes.forEach((r, i) => {
        console.log(`  R${i + 1}. ${r.organisme} — ${r.date ?? '?'}`);
        console.log(`      ${r.titre.slice(0, 108)}`);
        console.log(`      ${r.lien}\n`);
      });
    }
    console.log('\n  Sélection (mode --dry-run, aucun appel IA) :\n');
    retenus.forEach((a, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. [${a.score.toFixed(1)}]  ${a.theme} · ${a.typeEtude}`);
      console.log(`      ${a.titre.slice(0, 108)}`);
      console.log(`      ${a.journalAbrege || a.journal} — ${a.date ?? '?'}\n`);
    });
    console.log('  Aucun élément marqué comme vu : le registre n\'est écrit qu\'en mode réel.\n');

    // --audit : le seul moyen honnête de savoir si la coupe est bien placée.
    // On ne peut pas déduire d'un compteur de candidats si l'on a jeté quelque
    // chose d'utile — seule une lectrice de la spécialité peut le dire. Ce
    // fichier lui montre les rangs situés juste après la limite du jour.
    if (o.audit) {
      const chemin = path.join(RACINE, `audit-${new Date().toISOString().slice(0, 10)}.md`);
      const gardes = new Set(retenus);
      const suivants = inedits.filter((a) => !gardes.has(a)).slice(0, Math.max(0, o.audit - retenus.length));
      await writeFile(chemin, redigerAudit(retenus, suivants, classes.length), 'utf8');
      console.log(`  Audit de la coupe : ${chemin}`);
      console.log(`  À faire lire à une praticienne, avec une seule question :`);
      console.log(`  « dans les rangs ${retenus.length + 1} à ${o.audit}, y en a-t-il que vous auriez voulu lire ? »\n`);
    }
    return;
  }

  // Rien à ficher : pas un seul appel à l'API, pas même la résolution du
  // modèle. Le board est tout de même republié, daté du jour.
  const rienAFicher = retenus.length === 0 && recosBrutes.length === 0;
  let modele = null;
  if (rienAFicher) {
    console.log('\n  Rien de neuf à ficher — aucun appel à l\'API aujourd\'hui.');
  } else {
    modele = await resoudreModele(config.anthropic.model);
    console.log(`  Rédaction des fiches — ${modele}\n`);
  }

  // Réglages communs aux trois rédactions (fiches, recos, édito).
  const reglagesIA = {
    modele,
    themes: Object.keys(config.themes ?? {}),
    // La réflexion de Sonnet 5.5 compte dans max_tokens : un ancien config à
    // 1600 tronquerait des fiches. Le plafond ne coûte que ce qui est écrit.
    maxTokens: Math.max(config.anthropic.max_tokens ?? 0, 8000),
    effort: config.anthropic.effort,
    repli: config.anthropic.repli_refus,
  };

  let recos = [], recosRatees = [];
  if (recosBrutes.length) {
    ({ ok: recos, rates: recosRatees } = await avecReprise(ficherRecos, recosBrutes, {
      ...reglagesIA,
      concurrence: Math.min(3, config.anthropic.concurrence),
      onProgress: (n, total, el, res) =>
        console.log(`   ${res.erreur ? '✗' : '✓'} R${n}/${total}  ${(res.fiche?.titre_court ?? el.titre).slice(0, 74)}`),
    }));
  }

  const { ok: resultats, rates: articlesRates } = await avecReprise(ficherTous, retenus, {
    ...reglagesIA,
    concurrence: config.anthropic.concurrence,
    onProgress: (n, total, art, res) =>
      console.log(`   ${res.erreur ? '✗' : '✓'} ${String(n).padStart(2)}/${total}  ${(res.fiche?.titre_fr ?? art.titre).slice(0, 76)}`),
  });
  const manquants = articlesRates.length + recosRatees.length;

  // On distingue "rien à ficher aujourd'hui" (normal — le board est quand
  // même republié, avec la date du jour et un décompte à 0) de "on avait des
  // éléments à traiter mais l'IA n'a rien produit" (échec réel : clé API,
  // rate limit, réseau…). Avant ce correctif les deux cas étaient confondus,
  // le service sortait en erreur et le site n'était jamais republié.
  const attendu = retenus.length > 0 || recosBrutes.length > 0;
  if (attendu && !resultats.length && !recos.length) {
    console.error('\n  Aucune fiche générée alors que des éléments étaient à traiter — vérifiez la clé API ou les erreurs ci-dessus.\n');
    process.exitCode = 1;
    return;
  }
  if (!resultats.length && !recos.length) {
    console.log('\n  Rien de nouveau aujourd\'hui — le board est republié avec la date du jour.\n');
  }

  // Le thème choisi par le modèle est rabattu sur la liste du config : un
  // écart d'accent ou d'échappement créerait une rubrique fantôme sur le board.
  const listeThemes = Object.keys(config.themes ?? {});
  for (const r of resultats) r.fiche.theme = themeOfficiel(r.fiche.theme, listeThemes, r.article.theme ?? 'Autre');
  for (const r of recos) r.fiche.theme = themeOfficiel(r.fiche.theme, listeThemes, 'Autre');

  // Contrôle des chiffres avant toute publication : chaque nombre de la fiche
  // doit se retrouver dans le résumé source.
  const cA = controler(resultats, { type: 'article' });
  const cR = controler(recos, { type: 'reco' });
  const signalees = cA.signalees + cR.signalees;
  const totalFiches = cA.total + cR.total;
  if (totalFiches) {
    console.log(signalees
      ? `\n  ! ${signalees} fiche(s) sur ${totalFiches} comportent un chiffre absent du résumé source — signalées sur le board.`
      : `\n  Chiffres vérifiés : les ${totalFiches} fiches sont conformes à leur résumé source.`);
  }

  let edito = null, usageEdito = null;
  if (resultats.length || recos.length) {
    try { ({ edito, usage: usageEdito } = await redigerEdito(resultats, { ...reglagesIA, recos })); }
    catch (e) { console.warn(`\n  ! Édito non généré : ${e.message}`); }
  }

  // L'édito est un appel facturé comme les autres : il entre dans le compteur.
  const usage = [...resultats, ...recos, { usage: usageEdito }].reduce(
    (a, r) => ({ entree: a.entree + (r.usage?.input_tokens ?? 0), sortie: a.sortie + (r.usage?.output_tokens ?? 0) }),
    { entree: 0, sortie: 0 }
  );

  // Ce qui vient d'être publié est marqué comme vu : rien ne ressortira demain.
  for (const r of recos) registre.vus[r.element.id] = new Date().toISOString();
  marquerArticles(registre, resultats.map((r) => r.article));
  await enregistrerRegistre(RACINE, registre);

  // Les résumés d'origine, tels qu'ils ont servi au contrôle des chiffres.
  // C'est la même matière que `verif.mjs` a comparée à la fiche : la lectrice
  // peut donc vérifier elle-même ce que l'outil affirme avoir vérifié. Ils
  // partent dans un fichier voisin (cf. build.mjs), jamais dans le fichier du jour.
  const textesSource = {};
  for (const r of resultats) if (r.article?.resume) textesSource[r.article.id] = r.article.resume;
  for (const r of recos) if (r.element?.resume) textesSource[r.element.id] = r.element.resume;

  const fichesArticles = aplatir(resultats);
  const fichesRecos = aplatirRecos(recos);

  // Lecture vocale : un MP3 par fiche, s'il y a de quoi les fabriquer. Facultatif,
  // sans effet de bord — en cas d'absence de Piper le board lira avec la voix du
  // navigateur, et la veille ne s'interrompt pas pour autant.
  const site = o.sortie ?? path.join(RACINE, 'site');
  const jour = new Date().toISOString().slice(0, 10);
  await synthetiser({
    fiches: [
      ...fichesRecos.map((f) => ({ fiche: f, type: 'reco' })),
      ...fichesArticles.map((f) => ({ fiche: f, type: 'article' })),
    ],
    dossier: path.join(site, 'data', 'audio', jour),
    cheminRelatif: `data/audio/${jour}`,
    config, racine: RACINE,
  });

  const digest = fabriquerDigest({
    config, articles: fichesArticles, recos: fichesRecos, edito,
    sources: journal, sourcesFr: journalFr,
    scannes: articles.length, modele, usage, manquants,
    alerteHeures: config.fraicheur_alerte_heures ?? 48,
    textesSource,
  });

  const r = await construire({
    racine: RACINE, digest, sortie: o.sortie, inline: o.inline,
    conservation: config.jours_conservation ?? 0,
    retentionAudio: config.voix?.retention_jours ?? 7,
  });
  console.log(`\n  ${resultats.length} fiches${recos.length ? ` · ${recos.length} recommandation${recos.length > 1 ? 's' : ''}` : ''}` +
    `${manquants ? ` · ${manquants} fiche${manquants > 1 ? 's' : ''} NON générée${manquants > 1 ? 's' : ''}` : ''}` +
    ` · ${usage.entree + usage.sortie} tokens · ${chrono()}`);
  console.log(`  Site à jour : ${r.site}  (${r.jours} journée${r.jours > 1 ? 's' : ''} en ligne)`);
  if (r.inline) console.log(`  Fichier autonome : ${r.inline}`);

  // La veille est en ligne : on peut l'annoncer. Pas d'édito, pas de
  // notification — un matin sans nouveauté n'a pas à faire vibrer un téléphone.
  await notifierEdito({
    adresse: process.env.NOTIF_NTFY, url: process.env.MAJORDOC_URL || null,
    edito, nbArticles: resultats.length, nbRecos: recos.length,
  });
  console.log('');
}

main().catch((e) => {
  console.error(`\n  Erreur : ${e.message}\n`);
  process.exitCode = 1;
}).finally(lacherVerrou);
