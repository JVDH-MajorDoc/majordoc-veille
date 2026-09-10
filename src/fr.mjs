// MajorDoc — recommandations françaises (HAS, SFE, SFD…).
//
// Ces organismes n'exposent pas d'API : on passe par leurs flux RSS/Atom.
// Trois précautions, parce qu'une URL de flux change plus souvent qu'une API :
//   1. plusieurs URL candidates par source, essayées dans l'ordre ;
//   2. à défaut, découverte automatique depuis la page du site (balise
//      <link rel="alternate" type="application/rss+xml">) ;
//   3. mémorisation de l'URL qui a fonctionné dans data/flux-resolus.json.
//
// Un registre des éléments déjà publiés (data/deja-vus.json) évite qu'une
// recommandation ressorte tous les matins pendant trois mois.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chargerRegistre, enregistrerRegistre } from './registre.mjs';

const UA = 'MajorDoc/1.0 (veille bibliographique personnelle)';

/* ------------------------------------------------------------------ réseau */

async function texteDistant(url, { timeoutMs = 20000, essais = 2 } = {}) {
  let derniere;
  for (let i = 0; i < essais; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      derniere = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw derniere;
}

/* ------------------------------------------------------ analyse XML légère */

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', rsquo: '’', hellip: '…', ndash: '–', mdash: '—' };

export function decoder(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m)
    .trim();
}

function baliseTexte(bloc, ...noms) {
  for (const nom of noms) {
    const m = bloc.match(new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i'));
    if (m) {
      const v = decoder(m[1]);
      if (v) return v;
    }
  }
  return '';
}

function lienAtom(bloc) {
  // Atom : <link rel="alternate" href="…"/> — on ignore les rel="self" / "edit"
  const liens = [...bloc.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  for (const attrs of liens) {
    const rel = (attrs.match(/\brel=["']?([\w-]+)/i) ?? [])[1];
    const href = (attrs.match(/\bhref=["']([^"']+)["']/i) ?? [])[1];
    if (href && (!rel || rel.toLowerCase() === 'alternate')) return decoder(href);
  }
  return '';
}

function sansBalises(html) {
  return decoder(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/** Analyse un flux RSS 2.0 ou Atom. Renvoie une liste d'éléments normalisés. */
export function analyserFlux(xml, { origine = '' } = {}) {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("ce n'est pas un flux RSS ou Atom");

  const blocs = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const titreFlux = baliseTexte(xml.split(/<(item|entry)\b/i)[0], 'title') || '';

  const elements = blocs.map((b) => {
    const titre = baliseTexte(b, 'title');
    let lien = baliseTexte(b, 'link') || lienAtom(b);
    if (lien && origine) { try { lien = new URL(lien, origine).href; } catch { /* lien tel quel */ } }
    const brut = baliseTexte(b, 'content:encoded', 'description', 'summary', 'content');
    const dateBrute = baliseTexte(b, 'pubDate', 'published', 'updated', 'dc:date', 'date');
    const d = dateBrute ? new Date(dateBrute) : null;

    return {
      titre,
      lien,
      resume: sansBalises(brut).slice(0, 4000),
      date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null,
      guid: baliseTexte(b, 'guid', 'id') || lien || titre,
    };
  }).filter((e) => e.titre);

  return { titreFlux, elements };
}

/* --------------------------------------------------- découverte de flux */

/** Cherche les flux déclarés dans le HTML d'une page (autodiscovery + liens plausibles). */
export function candidatsDansHTML(html, origine) {
  const vus = new Set();
  const ajouter = (href) => {
    if (!href) return;
    try { vus.add(new URL(decoder(href), origine).href); } catch { /* ignoré */ }
  };

  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = m[1];
    if (/type=["']application\/(rss|atom)\+xml["']/i.test(a)) ajouter((a.match(/href=["']([^"']+)["']/i) ?? [])[1]);
  }
  for (const m of html.matchAll(/href=["']([^"']*(?:Rss2\.jsp[^"']*|\/feed\/?|rss[^"']*\.xml|\.xml|\/rss\/?)[^"']*)["']/gi)) {
    ajouter(m[1]);
  }
  return [...vus];
}

/** Renvoie le premier flux exploitable parmi les candidats, sinon explore la page du site. */
export async function resoudreFlux(source, { verbose = false } = {}) {
  // Garde-fou : un flux qui répond n'est pas forcément le bon. La HAS, par exemple,
  // sert un flux anglais sous une URL voisine — mieux vaut échouer que de publier
  // des avis de transparence en anglais dans un board français.
  const attendu = source.flux_titre_attendu ? new RegExp(source.flux_titre_attendu, 'i') : null;

  const essayer = async (url, essais = 2) => {
    const xml = await texteDistant(url, { essais });
    const { elements, titreFlux } = analyserFlux(xml, { origine: url });
    if (!elements.length) throw new Error('flux vide');
    if (attendu && !attendu.test(titreFlux)) {
      throw new Error(`flux inattendu : « ${titreFlux.slice(0, 60)} » ne correspond pas à /${source.flux_titre_attendu}/`);
    }
    return { url, elements, titreFlux };
  };

  const erreurs = [];

  // 1. Les adresses connues
  for (const url of source.flux ?? []) {
    try { return await essayer(url); } catch (e) { erreurs.push(`${url} → ${e.message}`); }
  }

  // 2. Les flux déclarés dans le HTML de la page du site
  for (const page of [].concat(source.page_decouverte ?? [])) {
    try {
      const html = await texteDistant(page);
      const candidats = candidatsDansHTML(html, page);
      if (verbose && candidats.length) console.log(`      ↳ ${candidats.length} candidat(s) déclaré(s) sur ${page}`);
      for (const url of candidats.slice(0, 12)) {
        try { return await essayer(url); } catch (e) { erreurs.push(`${url} → ${e.message}`); }
      }
    } catch (e) {
      erreurs.push(`${page} → ${e.message}`);
    }
  }

  // 3. Sondage : certains sites (la HAS) construisent leurs liens de flux par script,
  //    donc rien n'est déclaré dans le HTML. En revanche les identifiants internes,
  //    eux, y figurent. On les collecte et on interroge le gabarit d'URL pour chacun,
  //    en ne gardant que le flux dont le titre correspond à ce qu'on attend.
  if (source.sonde) {
    const r = await sonder(source, essayer, { verbose, erreurs });
    if (r) return r;
  }

  throw new Error(erreurs.slice(-3).join(' ; ') || 'aucun flux exploitable');
}

async function sonder(source, essayer, { verbose = false, erreurs = [] } = {}) {
  const { modele_url, motif_id, max = 40, pages } = source.sonde;
  const aExplorer = [].concat(pages ?? source.page_decouverte ?? []);
  const ids = new Set();

  for (const page of aExplorer) {
    try {
      const html = await texteDistant(page);
      for (const m of html.matchAll(new RegExp(motif_id, 'g'))) ids.add(m[0]);
    } catch (e) {
      erreurs.push(`${page} → ${e.message}`);
    }
  }
  if (!ids.size) return null;
  if (verbose) console.log(`      ↳ sondage de ${Math.min(ids.size, max)} identifiant(s) trouvé(s) dans la page`);

  for (const id of [...ids].slice(0, max)) {
    const url = modele_url.replace('{id}', id);
    try {
      const r = await essayer(url, 1);           // un seul essai : on en teste beaucoup
      if (verbose) console.log(`      ↳ trouvé par sondage : ${url}`);
      return r;
    } catch { /* identifiant suivant */ }
  }
  erreurs.push(`sondage de ${ids.size} identifiant(s) : aucun flux conforme`);
  return null;
}

/* ----------------------------------------------------------- pertinence */

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function pertinent(el, source) {
  // filtre_champ : "titre" pour les flux dont les résumés sont si longs qu'un mot-clé
  // finit toujours par y apparaître. Inclusion et exclusion jugent le même texte,
  // sinon un mot de la liste d'exclusion croisé au fond d'un résumé écarterait
  // silencieusement un article dont le titre était pourtant pertinent.
  const foin = sansAccents(source.filtre_champ === 'titre' ? el.titre : `${el.titre} ${el.resume}`);
  if ((source.exclure_mots ?? []).some((m) => foin.includes(sansAccents(m)))) return false;
  const mots = source.filtre_mots ?? [];
  if (!mots.length) return true;
  return mots.some((m) => foin.includes(sansAccents(m)));
}

function dansLaFenetre(el, jours) {
  if (!el.date) return true; // pas de date : on laisse le registre trancher
  return (Date.now() - new Date(el.date).getTime()) / 86400000 <= jours;
}

/* ------------------------------------------------------- enrichissement */

/** Récupère le texte de la page pour donner de la matière au résumé. */
export async function enrichir(el, { minResume = 400, maxTexte = 6000 } = {}) {
  if (!el.lien || el.resume.length >= minResume) return el;
  try {
    const html = await texteDistant(el.lien, { essais: 1, timeoutMs: 15000 });
    const zone = html.match(/<(?:main|article)\b[\s\S]*?<\/(?:main|article)>/i)?.[0] ?? html;
    const texte = sansBalises(zone);
    if (texte.length > el.resume.length) el.resume = texte.slice(0, maxTexte);
  } catch { /* on garde le résumé du flux */ }
  return el;
}

/* ------------------------------------------------------------ récolte */

export async function recolterRecos(config, { racine, verbose = true, registre } = {}) {
  const sources = config.sources_fr ?? [];
  const journal = [];
  const resolus = await chargerResolus(racine);
  const retenus = [];
  const vus = registre?.vus ?? {};
  const dejaPris = new Set();

  for (const source of sources) {
    const fenetre = source.fenetre_jours ?? config.fenetre_jours_recos ?? 120;
    const candidats = { ...source, flux: [...(resolus[source.id] ? [resolus[source.id]] : []), ...(source.flux ?? [])] };
    try {
      const { url, elements } = await resoudreFlux(candidats, { verbose });
      resolus[source.id] = url;

      const frais = elements
        .filter((e) => pertinent(e, source))
        .filter((e) => dansLaFenetre(e, fenetre))
        .filter((e) => !vus[cle(source, e)])
        .filter((e) => !dejaPris.has(cle(source, e)))   // une reco publiée dans deux flux HAS
        .slice(0, source.max ?? 6)
        .map((e) => {
          const id = cle(source, e);
          dejaPris.add(id);
          return { ...e, id, organisme: source.organisme, sourceLabel: source.label, poids: source.poids ?? 4 };
        });

      retenus.push(...frais);
      journal.push({ source: source.id, label: source.label, recus: frais.length, total: elements.length, fenetre, flux: url });
      if (verbose) console.log(`  ✓ ${source.label} : ${frais.length} nouveauté(s) sur ${elements.length} éléments`);
    } catch (e) {
      journal.push({ source: source.id, label: source.label, erreur: String(e.message ?? e).slice(0, 150) });
      if (verbose) console.warn(`  ✗ ${source.label} : ${e.message ?? e}`);
    }
  }

  await enregistrerResolus(racine, resolus);
  return { recos: retenus, journal };
}

/**
 * Clé d'identité d'une publication. On privilégie l'URL, normalisée : la même
 * recommandation paraît souvent dans deux flux d'un même organisme (« Recommandations »
 * et « Actualité » chez la HAS), et il ne faut la ficher — donc la payer — qu'une fois.
 */
function cle(source, el) {
  const brut = String(el.lien || el.guid || el.titre).trim();
  if (/^https?:\/\//i.test(brut)) {
    return brut.replace(/[#?].*$/, '').replace(/\/+$/, '').slice(0, 220);
  }
  return `${source.id}:${brut.slice(0, 200)}`;
}

async function chargerResolus(racine) {
  const f = path.join(racine, 'data', 'flux-resolus.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return {}; }
}
async function enregistrerResolus(racine, resolus) {
  await mkdir(path.join(racine, 'data'), { recursive: true });
  await writeFile(path.join(racine, 'data', 'flux-resolus.json'), JSON.stringify(resolus, null, 2));
}

export { texteDistant, sansBalises, chargerRegistre, enregistrerRegistre };
