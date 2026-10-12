// MajorDoc — détecter une source qui ne livre presque plus rien, et rattraper.
//
// Le 12/10/2026, Europe PMC n'a renvoyé que 13 articles indexés sur quatre
// jours, contre plus d'un millier d'habitude. Rien n'a échoué : les requêtes
// ont répondu, la veille a été publiée — vide — et elle avait l'air normale.
// Une source en panne se voit ; une source qui se tait ne se voit pas.
//
// Deux réponses ici, à partir des journées déjà publiées (chacune garde ce
// que chaque source a livré, dans `sources`) :
//   · detecterChute : le volume du jour comparé à la médiane des journées
//     récentes. Une chute franche est signalée (board, journal, alerte).
//   · fenetreDeRattrapage : tant que la source est anormalement pauvre, la
//     fenêtre de récolte remonte jusqu'à la dernière journée normale. Les
//     articles indexés pendant le trou ne sont donc pas perdus quand
//     l'indexation reprend ; le registre empêche de refaire les déjà vus.

import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

/** Une chute est franche sous ce rapport au volume habituel… */
export const RAPPORT_CHUTE = 0.15;
/** …et ne se juge que si le volume habituel est assez grand pour être stable. */
export const HABITUEL_MINIMUM = 50;
/** Le rattrapage ne remonte jamais plus loin : au-delà, il faut regarder à la main. */
export const RATTRAPAGE_MAX_JOURS = 21;

const JOUR = /^(\d{4}-\d{2}-\d{2})\.json$/;

function mediane(xs) {
  if (!xs.length) return 0;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/** Volume livré par les sources internationales ce jour-là (null si inconnu). */
export function volume(journal) {
  const ok = (journal ?? []).filter((j) => !j.erreur && Number.isFinite(j.total));
  return ok.length ? ok.reduce((s, j) => s + j.total, 0) : null;
}

/** Les journées publiées avant `avant`, de la plus récente à la plus ancienne. */
export async function historique(dossierData, { avant, jours = 14 } = {}) {
  let noms;
  try { noms = await readdir(dossierData); } catch { return []; }
  const dates = noms.map((n) => n.match(JOUR)?.[1]).filter((d) => d && (!avant || d < avant))
    .sort().reverse().slice(0, jours);
  const out = [];
  for (const date of dates) {
    try {
      const j = JSON.parse(await readFile(path.join(dossierData, `${date}.json`), 'utf8'));
      const v = volume(j.sources);
      if (v !== null && !j.demo) out.push({ date, volume: v, sources: j.sources });
    } catch { /* journée illisible : ignorée */ }
  }
  return out;
}

/** Le volume habituel : médiane des journées récentes qui n'étaient pas elles-mêmes en chute. */
export function habituel(hist) {
  const brut = mediane(hist.map((h) => h.volume));
  const normales = hist.filter((h) => h.volume >= brut * RAPPORT_CHUTE);
  return mediane(normales.map((h) => h.volume));
}

/**
 * Le volume du jour est-il une chute franche ? Renvoie null si tout va bien,
 * sinon de quoi l'expliquer : volume, habituel, et le détail par source.
 */
export function detecterChute(journal, hist) {
  const v = volume(journal);
  const h = habituel(hist);
  if (v === null || h < HABITUEL_MINIMUM || v >= h * RAPPORT_CHUTE) return null;
  const parSource = (journal ?? []).filter((j) => !j.erreur).map((j) => {
    const passes = hist.map((x) => x.sources?.find((s) => s.source === j.source)?.total).filter(Number.isFinite);
    return { source: j.source, label: j.label, total: j.total, habituel: Math.round(mediane(passes)) };
  });
  return { volume: v, habituel: Math.round(h), parSource };
}

/**
 * Fenêtre de récolte à utiliser aujourd'hui. Si les dernières journées étaient
 * des chutes, elle remonte jusqu'au lendemain de la dernière journée normale
 * (bornée) ; sinon, la fenêtre configurée.
 */
export function fenetreDeRattrapage(hist, { aujourdhui, fenetre }) {
  const h = habituel(hist);
  if (h < HABITUEL_MINIMUM) return { fenetre, depuis: null };
  const derniereNormale = hist.find((x) => x.volume >= h * RAPPORT_CHUTE);
  if (!derniereNormale || derniereNormale === hist[0]) return { fenetre, depuis: derniereNormale?.date ?? null };
  const ecart = Math.round((Date.parse(aujourdhui) - Date.parse(derniereNormale.date)) / 86400000);
  const voulue = Math.min(Math.max(fenetre, ecart + fenetre), RATTRAPAGE_MAX_JOURS);
  return { fenetre: voulue, depuis: derniereNormale.date };
}
