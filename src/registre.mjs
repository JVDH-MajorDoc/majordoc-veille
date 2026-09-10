// MajorDoc — registre des publications déjà fichées.
//
// Deux besoins, un seul mécanisme :
//   · une recommandation reste des mois dans le flux de son organisme ;
//   · un article PubMed reste plusieurs jours dans la fenêtre glissante.
// Sans registre, les deux ressortiraient chaque matin — et seraient refichés,
// donc repayés. On mémorise ce qui a déjà été publié dans un digest.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RETENTION_JOURS = 400;

function fichier(racine) {
  return path.join(racine, 'data', 'deja-vus.json');
}

export async function chargerRegistre(racine) {
  const f = fichier(racine);
  if (!existsSync(f)) return { vus: {}, articles: {} };
  try {
    const r = JSON.parse(await readFile(f, 'utf8'));
    return { vus: r.vus ?? {}, articles: r.articles ?? {} };
  } catch {
    return { vus: {}, articles: {} };
  }
}

export async function enregistrerRegistre(racine, registre, { retention = RETENTION_JOURS } = {}) {
  const limite = Date.now() - retention * 86400000;
  for (const bloc of [registre.vus, registre.articles]) {
    for (const [k, v] of Object.entries(bloc ?? {})) {
      if (new Date(v).getTime() < limite) delete bloc[k];
    }
  }
  await mkdir(path.join(racine, 'data'), { recursive: true });
  await writeFile(fichier(racine), JSON.stringify(registre, null, 2));
}

/** Clé stable d'un article : le PMID d'abord, le DOI ensuite, l'identifiant interne à défaut. */
export function cleArticle(a) {
  if (a.pmid) return `pmid:${a.pmid}`;
  if (a.doi) return `doi:${String(a.doi).toLowerCase()}`;
  return a.id ?? `titre:${String(a.titre ?? '').slice(0, 120)}`;
}

export function dejaVuArticle(registre, a) {
  return Boolean(registre.articles?.[cleArticle(a)]);
}

export function marquerArticles(registre, articles, quand = new Date().toISOString()) {
  registre.articles ??= {};
  for (const a of articles) registre.articles[cleArticle(a)] = quand;
  return registre;
}

export function compter(registre) {
  return {
    recos: Object.keys(registre.vus ?? {}).length,
    articles: Object.keys(registre.articles ?? {}).length,
  };
}
