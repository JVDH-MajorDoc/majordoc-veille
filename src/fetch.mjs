// MajorDoc — récupération des articles
// Source : Europe PMC REST (miroir de MEDLINE/PubMed, renvoie les abstracts
// en un seul appel — pas de clé API, pas de parsing XML).
// Docs : https://europepmc.org/RestfulWebService

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const UA = 'MajorDoc/1.0 (veille bibliographique personnelle)';

/** Date au format YYYY-MM-DD, décalée de n jours. */
export function isoDay(offsetJours = 0, from = new Date()) {
  const d = new Date(from.getTime() + offsetJours * 86400000);
  return d.toISOString().slice(0, 10);
}

async function getJSON(url, { timeoutMs = 25000, essais = 3 } = {}) {
  let derniereErreur;
  for (let i = 0; i < essais; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      derniereErreur = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw derniereErreur;
}

/**
 * Europe PMC plafonne une réponse à 1 000 résultats. Au-delà, il faut suivre le
 * `cursorMark` qu'il renvoie. Sans cette boucle, une requête à 1 042 résultats
 * en perdait 42 sans rien dire — et le jour où le vocabulaire s'élargit, ce
 * n'est plus 42 mais plusieurs centaines.
 *
 * `budget` borne le total rapatrié : la mémoire et le temps ne sont pas
 * infinis, et au-delà de quelques milliers de candidats le classement ne gagne
 * plus rien. Le dépassement éventuel est signalé par l'appelant, jamais tu.
 */
const PAR_PAGE = 1000;

async function toutesLesPages(v, budget) {
  const hits = [];
  let cursor = '*';
  let total = 0;

  while (hits.length < budget) {
    const params = new URLSearchParams({
      query: v.q,
      format: 'json',
      resultType: 'core',
      pageSize: String(Math.min(PAR_PAGE, budget - hits.length)),
      cursorMark: cursor,
    });
    if (v.sort) params.set('sort', v.sort);

    const data = await getJSON(`${BASE}?${params}`);
    total = Number(data?.hitCount ?? 0);
    const page = data?.resultList?.result ?? [];
    hits.push(...page);

    const suivant = data?.nextCursorMark;
    // Curseur absent, inchangé ou page vide : le serveur n'a plus rien à donner.
    if (!suivant || suivant === cursor || !page.length || hits.length >= total) break;
    cursor = suivant;
  }

  return { hits, total };
}

/**
 * Interroge Europe PMC. Renvoie une liste d'articles normalisés.
 * Deux garde-fous : si le tri par date est refusé on réessaie sans tri,
 * et si la requête complète échoue on réessaie sans le filtre de type.
 */
export async function chercher({ query, dateDebut, dateFin, pageSize = 100, champDate = 'FIRST_PDATE' }) {
  const filtreDate = `${champDate}:[${dateDebut} TO ${dateFin}]`;
  const complet = `(${query}) AND ${filtreDate} AND (SRC:MED OR SRC:PMC) AND HAS_ABSTRACT:Y`;

  const variantes = [
    { q: complet, sort: 'P_PDATE_D desc' },
    { q: complet, sort: null },
    { q: `(${query}) AND ${filtreDate}`, sort: null },
  ];

  let derniereErreur;
  for (const v of variantes) {
    try {
      const { hits, total } = await toutesLesPages(v, pageSize);
      if (hits.length || v === variantes[variantes.length - 1]) {
        return { articles: hits.map(normaliser).filter(Boolean), total, requete: v.q };
      }
    } catch (e) {
      derniereErreur = e;
    }
  }
  throw derniereErreur ?? new Error('Aucun résultat et aucune variante exploitable');
}

function texte(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normaliser(r) {
  const titre = texte(r.title).replace(/\s*\.\s*$/, '');
  const resume = texte(r.abstractText).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!titre || resume.length < 120) return null; // sans abstract exploitable, on jette

  const journal = texte(r.journalInfo?.journal?.title) || texte(r.journalTitle);
  const types = []
    .concat(r.pubTypeList?.pubType ?? [])
    .map((t) => texte(t).toLowerCase())
    .filter(Boolean);

  const pmid = texte(r.pmid);
  const doi = texte(r.doi);

  return {
    id: pmid ? `pmid:${pmid}` : doi ? `doi:${doi}` : `epmc:${texte(r.id)}`,
    pmid: pmid || null,
    doi: doi || null,
    titre,
    resume,
    journal,
    journalAbrege: texte(r.journalInfo?.journal?.medlineAbbreviation) || journal,
    auteurs: texte(r.authorString).replace(/\.$/, ''),
    date: texte(r.firstPublicationDate) || texte(r.journalInfo?.printPublicationDate) || null,
    types,
    langue: texte(r.language) || 'eng',
    accesLibre: r.isOpenAccess === 'Y',
    citations: Number(r.citedByCount ?? 0),
    liens: {
      pubmed: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
      doi: doi ? `https://doi.org/${doi}` : null,
      europepmc: `https://europepmc.org/article/${texte(r.source) || 'MED'}/${texte(r.id)}`,
    },
  };
}

/** Parcourt toutes les sources du config et fusionne les résultats (dédoublonnés). */
export async function recolter(config, { verbose = true, jourRef = new Date() } = {}) {
  const parId = new Map();
  const journal = [];

  for (const source of config.sources) {
    const fenetre = source.fenetre_jours ?? config.fenetre_jours ?? 4;
    const dateFin = isoDay(0, jourRef);
    const dateDebut = isoDay(-fenetre, jourRef);
    try {
      const { articles, total } = await chercher({
        query: source.query,
        dateDebut,
        dateFin,
        pageSize: source.page_size ?? 100,
        champDate: source.champ_date ?? config.champ_date ?? 'FIRST_PDATE',
      });
      // Garde-fou lié au champ de date. FIRST_IDATE date l'entrée dans l'index,
      // pas la parution : un article publié il y a deux ans mais indexé cette
      // semaine passerait le filtre et s'afficherait dans la veille du jour avec
      // sa vraie date, ce qui se lit comme une erreur. On borne donc l'âge.
      const ageMax = source.age_max_jours ?? config.age_max_jours ?? null;
      const retenus = ageMax
        ? articles.filter((a) => !a.date || (Date.now() - new Date(a.date).getTime()) / 86400000 <= ageMax)
        : articles;
      const tropVieux = articles.length - retenus.length;

      for (const a of retenus) {
        const existant = parId.get(a.id);
        if (existant) {
          existant.sources.push(source.id);
          existant.poidsSource = Math.max(existant.poidsSource, source.poids ?? 1);
          if (!existant.labelsSource.includes(source.label)) existant.labelsSource.push(source.label);
        } else {
          parId.set(a.id, {
            ...a,
            sources: [source.id],
            labelsSource: [source.label],
            poidsSource: source.poids ?? 1,
          });
        }
      }
      // La récolte ne pagine pas. Si le gisement dépasse la page demandée, le
      // reste n'est jamais soumis au classement : on le dit, plutôt que de
      // laisser un compte flatteur passer pour une couverture complète.
      // Le plafond n'est plus celui d'une page — la pagination les enchaîne —
      // mais le budget que la source s'accorde.
      const plafond = source.page_size ?? config.page_size ?? 1000;
      const tronque = total > plafond;

      journal.push({
        source: source.id, label: source.label, recus: retenus.length, total, fenetre,
        ...(tronque ? { tronqueA: plafond } : {}),
      });
      if (verbose && tronque) {
        console.warn(`    ! ${total} résultats pour un budget de ${plafond} : ${total - plafond} article(s) ` +
          'jamais soumis au classement. Relever page_size, ou resserrer la fenêtre.');
      }
      if (verbose) console.log(`  ✓ ${source.label} : ${retenus.length} article(s) retenus sur ${total} (${fenetre} j)` +
        (tropVieux ? ` · ${tropVieux} écarté(s), parution de plus de ${ageMax} j` : ''));
    } catch (e) {
      journal.push({ source: source.id, label: source.label, erreur: String(e.message ?? e) });
      if (verbose) console.warn(`  ✗ ${source.label} : ${e.message ?? e}`);
    }
  }

  return { articles: [...parId.values()], journal };
}
