#!/usr/bin/env node
// MajorDoc — outil de découverte et de contrôle des flux RSS.
//
//   npm run flux                          teste les sources françaises du config
//   npm run flux -- https://exemple.fr    cherche les flux d'un site quelconque
//   npm run flux -- --tout                affiche aussi les éléments écartés
//
// À lancer depuis la machine qui a accès au réseau. Les adresses qui répondent
// sont à recopier dans le champ "flux" de config.json.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { texteDistant, analyserFlux, candidatsDansHTML, pertinent, resoudreFlux } from './fr.mjs';
import { chargerRegistre, compter } from './registre.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOUT = process.argv.includes('--tout');

async function tester(url, source) {
  const xml = await texteDistant(url);
  const { elements, titreFlux } = analyserFlux(xml, { origine: url });
  if (!elements.length) throw new Error('flux vide');
  const gardes = source ? elements.filter((e) => pertinent(e, source)) : elements;
  const ecartes = source ? elements.filter((e) => !pertinent(e, source)) : [];
  const attendu = source?.flux_titre_attendu ? new RegExp(source.flux_titre_attendu, 'i') : null;
  return { url, titreFlux, elements, gardes, ecartes, conforme: !attendu || attendu.test(titreFlux) };
}

function ligne(e) {
  return `       ${e.date ?? '    ?     '}  ${e.titre.replace(/\s+/g, ' ').slice(0, 88)}`;
}

function afficher(r, source) {
  console.log(`     titre du flux : ${r.titreFlux || '—'}`);
  if (source?.flux_titre_attendu && !r.conforme) {
    console.log(`     ⚠ ce titre ne correspond pas à /${source.flux_titre_attendu}/ — flux refusé par MajorDoc`);
  }
  console.log(`     ${r.elements.length} élément(s)` + (source ? `, dont ${r.gardes.length} retenu(s) pour la spécialité` : ''));
  for (const e of (r.gardes.length ? r.gardes : r.elements).slice(0, 6)) console.log(ligne(e));
  if (TOUT && r.ecartes.length) {
    console.log(`     — écartés (${r.ecartes.length}) :`);
    for (const e of r.ecartes.slice(0, 8)) console.log(ligne(e));
  }
}

async function explorer(url) {
  console.log(`\n  Exploration de ${url}\n`);
  let candidats = [url];
  try {
    const html = await texteDistant(url);
    if (!/<(rss|feed|rdf:RDF)\b/i.test(html)) {
      candidats = candidatsDansHTML(html, url);
      if (!candidats.length) {
        console.log("  Cette page ne déclare aucun flux RSS.\n");
        console.log('  Si le site en publie un, il est probablement inséré par un script :');
        console.log("  ouvrez la page dans un navigateur, clic droit sur l'icône RSS/XML,");
        console.log("  « Copier l'adresse du lien », puis re-testez cette adresse avec :");
        console.log(`  npm run flux -- L-ADRESSE-COPIEE\n`);
        return;
      }
      console.log(`  ${candidats.length} candidat(s) déclaré(s) dans la page :\n`);
    }
  } catch (e) {
    console.error(`  Page inaccessible : ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  let trouve = 0;
  for (const u of candidats.slice(0, 15)) {
    try {
      const r = await tester(u);
      trouve++;
      console.log(`  ✓ ${u}`);
      afficher(r);
      console.log('');
    } catch (e) {
      console.log(`  ✗ ${u}\n     ${e.message}\n`);
    }
  }
  console.log(trouve ? `  ${trouve} flux exploitable(s).\n` : '  Aucun flux exploitable.\n');
}

async function main() {
  const cible = process.argv.slice(2).find((a) => a.startsWith('http'));
  if (cible) return explorer(cible);

  const config = JSON.parse(await readFile(path.join(RACINE, 'config.json'), 'utf8'));
  const sources = config.sources_fr ?? [];
  if (!sources.length) { console.log('\n  Aucune source française déclarée dans config.json.\n'); return; }

  console.log(`\n  Contrôle des ${sources.length} sources françaises`);
  if (!TOUT) console.log('  (ajoutez --tout pour voir aussi les éléments écartés par les filtres)');

  // Le registre explique la plupart des « 0 nouveauté » : une publication déjà fichée
  // un jour précédent ne ressort pas.
  const n = compter(await chargerRegistre(RACINE));
  if (n.recos || n.articles) {
    console.log(`  Déjà fichés les jours précédents : ${n.recos} recommandation(s), ${n.articles} article(s).`);
    console.log('  Ils ne ressortiront pas. Pour tout reprendre à zéro : node src/run.mjs --oublier');
  }
  console.log('');

  const aRegler = [];

  for (const source of sources) {
    console.log(`  ${source.label}`);
    try {
      // Même chemin de résolution que la génération : adresses connues, puis flux
      // déclarés dans la page, puis sondage des identifiants.
      const { url, elements, titreFlux } = await resoudreFlux(source, { verbose: true });
      const gardes = elements.filter((e) => pertinent(e, source));
      const ecartes = elements.filter((e) => !pertinent(e, source));
      console.log(`  \u2713 ${url}`);
      afficher({ url, titreFlux, elements, gardes, ecartes, conforme: true }, source);
    } catch (e) {
      aRegler.push(source);
      console.log(`  \u2717 ${e.message}`);
      if (source.commentaire) console.log(`     ${source.commentaire.replace(/\s+/g, ' ')}`);
    }
    console.log('');
  }

  if (aRegler.length) {
    console.log('  ─────────────────────────────────────────────────────────');
    console.log(`  ${aRegler.length} source(s) à régler : ${aRegler.map((s) => s.id).join(', ')}`);
    console.log('  MajorDoc fonctionne sans : ces sources seront simplement signalées');
    console.log('  en rouge dans le pied de page du board.');
    console.log('');
    for (const s of aRegler) {
      console.log(`  ${s.label}  (sources_fr → "${s.id}")`);
      console.log(`    Chercher une adresse de flux :  npm run flux -- ${[].concat(s.page_decouverte ?? [])[0] ?? 'https://le-site.fr'}`);
      console.log(`    Puis la coller dans config.json → sources_fr → "${s.id}" → "flux".`);
      console.log('');
    }
  } else {
    console.log('  Toutes les sources répondent.\n');
  }
}

main().catch((e) => { console.error(`\n  Erreur : ${e.message}\n`); process.exitCode = 1; });
