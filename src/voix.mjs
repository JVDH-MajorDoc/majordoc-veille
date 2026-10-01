// MajorDoc — lecture vocale : fabrication des fichiers audio.
//
// Pourquoi un fichier plutôt que la synthèse du navigateur : sur iPhone et iPad,
// Safari n'expose pas à la Web Speech API les voix « Améliorée » et « Premium »
// d'Apple, même téléchargées. Il ne reste que les voix compactes, et c'est un
// plafond qu'aucun réglage côté page ne franchit. Or c'est sur mobile que la
// veille se lit.
//
// Le choix d'un moteur local (Piper) n'est pas seulement économique. Une API de
// synthèse ferait sortir le texte du cabinet et doublerait le coût quotidien de
// l'outil pour une fonction de confort. Piper tourne sur le CPU du conteneur,
// ne coûte rien à l'usage, et ne parle à personne.
//
// Tout ici est facultatif et sans effet de bord : si Piper manque, si le modèle
// est absent, si l'encodage échoue, la génération continue et le board retombe
// sur `speechSynthesis`. Une veille ne s'interrompt pas pour une voix.

import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Rubriques lues, dans l'ordre où le board les affiche. */
const RUBRIQUES_ARTICLE = [
  ['contexte', 'Contexte'],
  ['methode', 'Méthode'],
  ['resultats', 'Résultats'],
  ['conclusion', 'Conclusion'],
  ['pour_la_pratique', 'Pour la pratique'],
  ['limites', 'Limites'],
];
const RUBRIQUES_RECO = [
  ['ce_qui_change', 'Ce qui change'],
  ['points_cles', 'Points clés'],
  ['population', 'Population'],
  ['pour_la_pratique', 'Pour la pratique'],
];

function phrase(t) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/**
 * Le texte lu pour une fiche — exactement ce que le board lirait à voix haute
 * s'il n'y avait pas de fichier. Auteurs et mots-clés en sont écartés : ce sont
 * des listes qu'on parcourt des yeux, pas de la prose qu'on écoute.
 */
export function texteFiche(x, { type = 'article' } = {}) {
  const bouts = [];
  bouts.push(phrase(type === 'reco' ? (x.titre_court || x.titreOriginal) : (x.titre_fr || x.titre)));
  bouts.push(phrase(x.accroche));
  for (const [cle, titre] of (type === 'reco' ? RUBRIQUES_RECO : RUBRIQUES_ARTICLE)) {
    const v = x[cle];
    const texte = Array.isArray(v) ? v.map(phrase).join(' ') : phrase(v);
    if (!texte) continue;
    bouts.push(phrase(titre), texte);
  }
  return bouts.filter(Boolean).join(' ');
}

/** Un identifiant comme « pmid:12345 » ne fait pas un nom de fichier. */
export function nomFichier(id) {
  const base = String(id ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'fiche'}.mp3`;
}

/**
 * Les arguments passés au moteur.
 *
 * Par défaut ceux de Piper. `config.voix.arguments` permet d'en donner d'autres,
 * avec trois jetons remplacés à l'appel : {modele}, {sortie}, {locuteur}. C'est
 * ce qui permettra de brancher un autre moteur — Kokoro, ou ce qui viendra
 * après — sans toucher à une ligne de ce fichier. Le texte, lui, arrive toujours
 * sur l'entrée standard.
 *
 * `locuteur` sert aux modèles multi-voix : `fr_FR-mls-medium` en contient 125,
 * et c'est de loin la façon la moins chère d'en essayer d'autres.
 */
export function argumentsMoteur(v, modele, sortie) {
  const locuteur = v.locuteur == null ? null : String(v.locuteur);
  if (Array.isArray(v.arguments) && v.arguments.length) {
    return v.arguments
      .map((a) => String(a)
        .replace('{modele}', modele)
        .replace('{sortie}', sortie)
        .replace('{locuteur}', locuteur ?? ''))
      .filter((a) => a !== '');
  }
  const args = [
    '-m', modele,
    '-f', sortie,
    '--sentence-silence', String(v.silence_phrase ?? 0.35),
    '--length-scale', String(v.longueur ?? 1),
  ];
  if (v.noise_w != null) args.push('--noise-w-scale', String(v.noise_w));
  if (v.noise != null) args.push('--noise-scale', String(v.noise));
  if (locuteur !== null) args.push('-s', locuteur);
  return args;
}

function lancer(commande, args, { entree = null, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(commande, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${commande} : délai dépassé`)); }, timeout);
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { clearTimeout(minuteur); reject(new Error(`${commande} introuvable (${e.code ?? e.message})`)); });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve();
      else reject(new Error(`${commande} a renvoyé ${code}${err ? ` : ${err.trim().split('\n').pop()}` : ''}`));
    });
    if (entree != null) { p.stdin.write(entree); }
    p.stdin.end();
  });
}

/**
 * Fabrique un MP3 par fiche dans `dossier`, et pose le chemin relatif du
 * fichier sur chaque fiche (`fiche.audio`) pour que le board sache qu'il existe.
 *
 * @returns {{actif:boolean, faits:number, echecs:number, octets:number, motif?:string}}
 */
export async function synthetiser({ fiches, dossier, cheminRelatif, config, racine = process.cwd(), log = console.log }) {
  const v = config?.voix ?? {};
  if (!v.actif) return { actif: false, faits: 0, echecs: 0, octets: 0 };

  const commande = v.commande || 'piper';
  const encodeur = v.encodeur || 'ffmpeg';
  const modele = v.modele
    ? (path.isAbsolute(v.modele) ? v.modele : path.join(racine, v.modele))
    : null;

  if (!modele || !existsSync(modele)) {
    log(`  ! Voix désactivée : modèle introuvable (${v.modele ?? 'config.voix.modele absent'}). Le board lira avec la voix du navigateur.`);
    return { actif: false, faits: 0, echecs: 0, octets: 0, motif: 'modele' };
  }

  await mkdir(dossier, { recursive: true });
  let faits = 0, echecs = 0, octets = 0;

  for (const { fiche, type } of fiches) {
    const texte = texteFiche(fiche, { type });
    if (!texte) continue;
    const nom = nomFichier(fiche.id);
    const wav = path.join(tmpdir(), `majordoc-${process.pid}-${faits + echecs}.wav`);
    const mp3 = path.join(dossier, nom);
    try {
      await lancer(commande, argumentsMoteur(v, modele, wav), { entree: texte });

      await lancer(encodeur, [
        '-y', '-loglevel', 'error', '-i', wav,
        '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', v.debit || '32k',
        mp3,
      ]);

      octets += (await stat(mp3)).size;
      fiche.audio = `${cheminRelatif}/${nom}`;
      faits++;
    } catch (e) {
      echecs++;
      // Le premier échec dit pourquoi ; les suivants se comptent en silence,
      // sinon une commande manquante remplit la sortie de quinze fois la même ligne.
      if (echecs === 1) log(`  ! Voix : ${e.message}`);
    } finally {
      await unlink(wav).catch(() => {});
    }
  }

  if (faits) log(`  Voix : ${faits} fiche(s) lues${echecs ? `, ${echecs} en échec` : ''} · ${(octets / 1048576).toFixed(1)} Mo`);
  else if (echecs) log(`  ! Voix : aucune fiche générée. Le board lira avec la voix du navigateur.`);
  return { actif: faits > 0, faits, echecs, octets };
}

/**
 * Purge les journées d'audio trop anciennes.
 *
 * L'audio a sa propre rétention, bien plus courte que celle des fiches : une
 * journée pèse quelques mégaoctets contre 25 Ko de texte, et personne n'écoute
 * la fiche du mois dernier. Sans ce garde-fou, l'archive passerait de 9 Mo
 * par an à près de deux gigaoctets.
 */
export async function purgerAudio(racineAudio, retentionJours) {
  if (!retentionJours || retentionJours <= 0 || !existsSync(racineAudio)) return { supprimees: 0 };
  const limite = new Date(Date.now() - retentionJours * 86400000).toISOString().slice(0, 10);
  let supprimees = 0;
  for (const nom of await readdir(racineAudio)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nom) || nom >= limite) continue;
    await rm(path.join(racineAudio, nom), { recursive: true, force: true });
    supprimees++;
  }
  return { supprimees };
}
