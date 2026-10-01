#!/usr/bin/env node
// MajorDoc — planche d'écoute : comparer des voix côte à côte, sur du vrai texte.
//
//   node src/auditionner.mjs voix/fr_FR-siwis-medium.onnx voix/fr_FR-tom-medium.onnx
//   node src/auditionner.mjs voix/fr_FR-mls-medium.onnx --locuteurs 0,12,37,64,91
//   node src/auditionner.mjs voix/*.onnx --longueurs 1,1.1
//
// Produit `audition/index.html` : une page où chaque candidat a son lecteur, sur
// la même phrase. On écoute, on note, on tranche — au lieu de régénérer la
// veille entière à chaque essai.
//
// La phrase n'est pas choisie au hasard : elle porte un chiffre décimal, un
// sigle, un mot anglais et une incise, c'est-à-dire tout ce sur quoi une voix
// de synthèse trébuche dans une fiche de lecture réelle.

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PHRASE = "Co-agoniste incrétine hebdomadaire versus insuline basale. " +
  "Sur cinquante-deux semaines, l'HbA1c baisse de 0,62 point de plus, " +
  "intervalle de confiance à 95 % de 0,74 à 0,50, avec 8,4 kilos de perte de poids. " +
  "Pour la pratique : un argument de plus pour retarder l'insuline basale, " +
  "mais le coût reste l'obstacle principal en ville.";

function lire(argv) {
  const o = { modeles: [], locuteurs: [null], longueurs: [null], commande: 'piper', encodeur: 'ffmpeg', phrase: PHRASE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--locuteurs') o.locuteurs = argv[++i].split(',').map((x) => x.trim());
    else if (a === '--longueurs') o.longueurs = argv[++i].split(',').map((x) => x.trim());
    else if (a === '--commande') o.commande = argv[++i];
    else if (a === '--encodeur') o.encodeur = argv[++i];
    else if (a === '--phrase') o.phrase = argv[++i];
    else if (a === '--aide' || a === '-h') o.aide = true;
    else o.modeles.push(a);
  }
  return o;
}

function lancer(commande, args, entree) {
  return new Promise((resolve, reject) => {
    const p = spawn(commande, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => reject(new Error(`${commande} : ${e.code ?? e.message}`)));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${commande} → ${c} ${err.trim().split('\n').pop() ?? ''}`))));
    if (entree != null) p.stdin.write(entree);
    p.stdin.end();
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function main() {
  const o = lire(process.argv.slice(2));
  if (o.aide || !o.modeles.length) {
    console.log(`
  Planche d'écoute — comparer des voix sur la même phrase.

    node src/auditionner.mjs <modele.onnx> [autre.onnx ...]
       --locuteurs 0,12,37     pour un modèle multi-voix (mls en contient 125)
       --longueurs 1,1.1       la diction, au-dessus de 1 elle ralentit
       --commande CHEMIN       défaut : piper
       --phrase "..."          votre propre texte

  Puis ouvrir audition/index.html.
`);
    return;
  }

  const sortie = path.join(RACINE, 'audition');
  await rm(sortie, { recursive: true, force: true });
  await mkdir(sortie, { recursive: true });

  const candidats = [];
  for (const m of o.modeles) {
    const modele = path.isAbsolute(m) ? m : path.join(RACINE, m);
    if (!existsSync(modele)) { console.error(`  ! Modèle introuvable : ${modele}`); continue; }
    for (const loc of o.locuteurs) {
      for (const lon of o.longueurs) {
        candidats.push({ modele, nom: path.basename(modele, '.onnx'), locuteur: loc, longueur: lon });
      }
    }
  }
  if (!candidats.length) { console.error('  Aucun modèle exploitable.\n'); process.exitCode = 1; return; }

  console.log(`\n  ${candidats.length} candidat(s) à synthétiser…\n`);
  const faits = [];
  for (const [i, c] of candidats.entries()) {
    const etiquette = c.nom + (c.locuteur != null ? ` · voix ${c.locuteur}` : '') + (c.longueur != null ? ` · débit ${c.longueur}` : '');
    const base = `${String(i + 1).padStart(2, '0')}-${c.nom}${c.locuteur != null ? `-s${c.locuteur}` : ''}${c.longueur != null ? `-l${c.longueur}` : ''}`;
    const wav = path.join(sortie, `${base}.wav`);
    const mp3 = path.join(sortie, `${base}.mp3`);
    const args = ['-m', c.modele, '-f', wav, '--sentence-silence', '0.35'];
    if (c.longueur != null) args.push('--length-scale', String(c.longueur));
    if (c.locuteur != null) args.push('-s', String(c.locuteur));

    const t0 = Date.now();
    try {
      await lancer(o.commande, args, o.phrase);
      await lancer(o.encodeur, ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', mp3]);
      await rm(wav, { force: true });
      const octets = (await stat(mp3)).size;
      faits.push({ ...c, etiquette, fichier: path.basename(mp3), secondes: ((Date.now() - t0) / 1000).toFixed(1), ko: Math.round(octets / 1024) });
      console.log(`  ${etiquette} — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      console.error(`  ! ${etiquette} : ${e.message}`);
    }
  }

  if (!faits.length) { console.error('\n  Rien n\'a pu être synthétisé.\n'); process.exitCode = 1; return; }

  await writeFile(path.join(sortie, 'index.html'), page(faits, o.phrase), 'utf8');
  console.log(`\n  Planche d'écoute : ${path.join(sortie, 'index.html')}`);
  console.log(`  Depuis un poste distant : python3 -m http.server -d ${sortie} 8080\n`);
}

function page(faits, phrase) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MajorDoc — planche d'écoute</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 780px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .phrase { color: #666; font-size: 14.5px; border-left: 3px solid #16324a; padding-left: 14px; margin: 18px 0 30px; }
  .c { border-top: 1px solid #ddd; padding: 16px 0; display: grid; gap: 8px; }
  .t { font-weight: 600; font-size: 15px; }
  .m { color: #777; font-size: 12.5px; }
  audio { width: 100%; }
  footer { margin-top: 34px; color: #777; font-size: 13px; border-top: 1px solid #ddd; padding-top: 16px; }
  code { background: #eee9df; padding: 1px 5px; border-radius: 3px; font-size: .92em; }
  @media (prefers-color-scheme: dark) { body { background:#14171a; color:#e9e7e1 } .c{border-color:#2a2f33} .phrase,.m,footer{color:#9aa09b} code{background:#252a2e} footer{border-color:#2a2f33} }
</style></head><body>
<h1>Planche d'écoute</h1>
<p class="m">${faits.length} candidat${faits.length > 1 ? 's' : ''}, la même phrase pour tous.</p>
<p class="phrase">${esc(phrase)}</p>
${faits.map((f) => `<div class="c">
  <div class="t">${esc(f.etiquette)}</div>
  <audio controls preload="none" src="${esc(f.fichier)}"></audio>
  <div class="m">${f.secondes} s de synthèse · ${f.ko} Ko</div>
</div>`).join('\n')}
<footer>
  Le gagnant se reporte dans <code>config.json</code> → <code>voix</code> :
  <code>modele</code>, et <code>locuteur</code> pour un modèle multi-voix.
</footer>
</body></html>`;
}

main().catch((e) => { console.error(`\n  Erreur : ${e.message}\n`); process.exitCode = 1; });
