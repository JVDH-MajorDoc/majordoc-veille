// MajorDoc — PubMed en direct, quand Europe PMC ne suit plus.
//
// Depuis le 06/10/2026, Europe PMC n'importe presque plus rien de MEDLINE :
// 0 à 13 articles indexés par jour, contre 1 500 à 5 500 avant — alors que
// PubMed, lui, en publiait 4 000 à 6 000. Les articles récents n'y sont tout
// simplement pas (vérifié PMID par PMID). Élargir la fenêtre ne rattrape rien
// tant que le miroir ne s'est pas remis à jour.
//
// Ce module interroge donc la source elle-même, par les E-utilities du NCBI
// (https://www.ncbi.nlm.nih.gov/books/NBK25499/), avec les MÊMES requêtes :
// elles sont traduites de la syntaxe Europe PMC. Le choix de basculer se fait
// à chaque passage par une sonde (sonderEuropePmc) : dès que le miroir s'est
// remis à jour, la veille revient d'elle-même à Europe PMC.
//
// Pas de dépendance : l'XML de PubMed est assez régulier pour être lu à la main.

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const UA = 'MajorDoc/1.0 (veille bibliographique personnelle)';

/** En dessous de cette part du volume de PubMed, Europe PMC est jugé en retard. */
export const RAPPORT_RETARD = 0.15;
/** La sonde ne conclut que sur un volume PubMed assez grand pour être stable. */
export const SONDE_MINIMUM = 500;
/** efetch : identifiants par requête (le NCBI recommande de rester sous 200 en GET ; on poste). */
const LOT = 200;

// ——— Traduction des requêtes ——————————————————————————————————————————————

/** Champs Europe PMC → étiquettes PubMed. */
const CHAMPS = {
  TITLE_ABS: 'tiab',
  TITLE: 'ti',
  ABSTRACT: 'ab',
  PUB_TYPE: 'pt',
  JOURNAL: 'journal',
  LANG: 'la',
  AUTH: 'au',
  MESH: 'mh',
  KW: 'ot',
};

/**
 * Traduit une requête Europe PMC en requête PubMed. Les opérateurs et les
 * parenthèses sont communs aux deux ; seuls les champs changent d'écriture
 * (`TITLE_ABS:diabet*` → `diabet*[tiab]`). Un champ sans équivalent fait
 * échouer la traduction plutôt que d'être ignoré : une requête silencieusement
 * élargie ramènerait n'importe quoi.
 */
export function traduireRequete(requete) {
  const inconnus = new Set();
  const traduite = String(requete).replace(/\b([A-Z_]{2,}):("[^"]*"|[^\s()"]+)/g, (tout, champ, valeur) => {
    if (champ === 'HAS_ABSTRACT') {
      if (valeur.toUpperCase() === 'Y') return 'hasabstract';
      inconnus.add(`${champ}:${valeur}`);
      return tout;
    }
    const etiquette = CHAMPS[champ];
    if (!etiquette) {
      inconnus.add(champ);
      return tout;
    }
    return `${valeur}[${etiquette}]`;
  });
  if (inconnus.size) {
    throw new Error(`champ(s) sans équivalent PubMed : ${[...inconnus].join(', ')}`);
  }
  return traduite;
}

// ——— Appels au NCBI ——————————————————————————————————————————————————————

// Sans clé, le NCBI tolère 3 requêtes par seconde ; avec NCBI_API_KEY, 10.
// Au-delà il répond 429 : on espace les appels plutôt que de subir des refus.
let dernierAppel = 0;
async function patienter() {
  const ecart = process.env.NCBI_API_KEY ? 110 : 350;
  const attente = dernierAppel + ecart - Date.now();
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
  dernierAppel = Date.now();
}

async function appelNcbi(outil, params, { format = 'json', timeoutMs = 45000, essais = 3 } = {}) {
  const corps = new URLSearchParams({ ...params, tool: 'majordoc' });
  if (process.env.NCBI_API_KEY) corps.set('api_key', process.env.NCBI_API_KEY);
  let derniereErreur;
  for (let i = 0; i < essais; i++) {
    await patienter();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // POST : la requête construite depuis les thèmes dépasse la longueur
      // qu'une URL supporte sans encombre (plus de 140 termes).
      const r = await fetch(`${EUTILS}/${outil}.fcgi`, {
        method: 'POST',
        body: corps,
        signal: ctrl.signal,
        headers: { 'User-Agent': UA },
      });
      if (!r.ok) throw new Error(`PubMed ${outil} : HTTP ${r.status} ${r.statusText}`);
      return format === 'json' ? await r.json() : await r.text();
    } catch (e) {
      derniereErreur = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw derniereErreur;
}

const dateNcbi = (iso) => iso.replaceAll('-', '/');

/** FIRST_IDATE date l'entrée dans l'index : son pendant PubMed est la date Entrez. */
function typeDate(champDate) {
  return champDate === 'FIRST_PDATE' ? 'pdat' : 'edat';
}

async function compterPubmed(terme, { dateDebut, dateFin, champDate = 'FIRST_IDATE' }) {
  const data = await appelNcbi('esearch', {
    db: 'pubmed', retmode: 'json', retmax: '0', term: terme,
    datetype: typeDate(champDate), mindate: dateNcbi(dateDebut), maxdate: dateNcbi(dateFin),
  });
  return Number(data?.esearchresult?.count ?? 0);
}

/**
 * Même contrat que `chercher` (fetch.mjs) : { articles, total, requete }.
 * `query` est en syntaxe Europe PMC, traduite ici.
 */
export async function chercherPubmed({ query, dateDebut, dateFin, pageSize = 100, champDate = 'FIRST_IDATE' }) {
  const terme = `(${traduireRequete(query)}) AND hasabstract`;
  const recherche = await appelNcbi('esearch', {
    db: 'pubmed', retmode: 'json', term: terme, sort: 'pub_date',
    retmax: String(Math.min(pageSize, 9999)),
    datetype: typeDate(champDate), mindate: dateNcbi(dateDebut), maxdate: dateNcbi(dateFin),
  });
  const r = recherche?.esearchresult;
  if (!r) throw new Error('PubMed esearch : réponse illisible');
  if (r.errorlist?.phrasesnotfound?.length || r.errorlist?.fieldsnotfound?.length) {
    // Un terme que PubMed ne reconnaît pas est retiré en silence de la requête :
    // on le dit dans le journal plutôt que de laisser croire à une requête intacte.
    console.warn(`    ! PubMed a ignoré : ${[...(r.errorlist.phrasesnotfound ?? []), ...(r.errorlist.fieldsnotfound ?? [])].join(', ')}`);
  }
  const ids = r.idlist ?? [];
  const articles = [];
  for (let i = 0; i < ids.length; i += LOT) {
    const xml = await appelNcbi('efetch', { db: 'pubmed', retmode: 'xml', id: ids.slice(i, i + LOT).join(',') }, { format: 'xml' });
    articles.push(...analyserXml(xml));
  }
  return { articles, total: Number(r.count ?? 0), requete: terme };
}

/** Les articles de ces PMID, dans l'ordre demandé (ceux qui manquent ou sans abstract sont omis). */
export async function articlesParPmid(pmids) {
  const parPmid = new Map();
  for (let i = 0; i < pmids.length; i += LOT) {
    const xml = await appelNcbi('efetch', { db: 'pubmed', retmode: 'xml', id: pmids.slice(i, i + LOT).join(',') }, { format: 'xml' });
    for (const a of analyserXml(xml)) parPmid.set(a.pmid, a);
  }
  return pmids.map((p) => parPmid.get(String(p))).filter(Boolean);
}

// ——— La sonde ————————————————————————————————————————————————————————————

/** Décision pure, testable : Europe PMC est-il en retard sur PubMed ? */
export function europePmcEnRetard({ europepmc, pubmed }) {
  if (!Number.isFinite(europepmc) || !Number.isFinite(pubmed) || pubmed < SONDE_MINIMUM) return false;
  return europepmc < pubmed * RAPPORT_RETARD;
}

/**
 * Compare ce que les deux bases ont indexé sur les trois derniers jours
 * pleins. Trois jours plutôt qu'un : les deux bases n'indexent pas au même
 * rythme (PubMed publie peu le week-end, Europe PMC rattrape le lundi) et
 * un seul jour donnerait de fausses alertes. Renvoie null si l'une des deux
 * ne répond pas : dans le doute, on garde Europe PMC.
 */
export async function sonderEuropePmc({ jourRef = new Date() } = {}) {
  const jour = (n) => new Date(jourRef.getTime() - n * 86400000).toISOString().slice(0, 10);
  const dateDebut = jour(3), dateFin = jour(1);
  try {
    const params = new URLSearchParams({
      query: `FIRST_IDATE:[${dateDebut} TO ${dateFin}] AND SRC:MED`, format: 'json', pageSize: '1', resultType: 'idlist',
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    let europepmc;
    try {
      const r = await fetch(`${EPMC}?${params}`, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      europepmc = Number((await r.json())?.hitCount);
    } finally {
      clearTimeout(t);
    }
    const pubmed = await compterPubmed('all[sb]', { dateDebut, dateFin });
    return { europepmc, pubmed, dateDebut, dateFin, enRetard: europePmcEnRetard({ europepmc, pubmed }) };
  } catch {
    return null;
  }
}

// ——— Lecture de l'XML PubMed —————————————————————————————————————————————

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decoder(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : tout;
    }
    return ENTITES[e.toLowerCase()] ?? tout;
  });
}

/** Texte d'un fragment : balises internes (<i>, <sup>, MathML…) retirées, entités décodées. */
function texte(fragment) {
  if (fragment == null) return '';
  return decoder(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Toutes les occurrences d'une balise : [{ attrs, contenu }]. */
function toutes(xml, nom) {
  const re = new RegExp(`<${nom}(\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'g');
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? '', contenu: m[2] }));
}
const premiere = (xml, nom) => toutes(xml, nom)[0] ?? null;
const attr = (attrs, nom) => attrs.match(new RegExp(`\\b${nom}="([^"]*)"`))?.[1] ?? null;

const MOIS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Une date PubMed (Year / Month / Day, ou MedlineDate « 2026 Sep-Oct ») en AAAA-MM-JJ. */
function lireDate(fragment) {
  if (!fragment) return null;
  const an = texte(premiere(fragment, 'Year')?.contenu);
  if (!/^\d{4}$/.test(an)) {
    const m = texte(premiere(fragment, 'MedlineDate')?.contenu).match(/^(\d{4})(?:\s+([A-Za-z]{3}))?/);
    if (!m) return null;
    return `${m[1]}-${String(MOIS[m[2]?.toLowerCase()] ?? 1).padStart(2, '0')}-01`;
  }
  const brut = texte(premiere(fragment, 'Month')?.contenu);
  const mois = /^\d+$/.test(brut) ? Number(brut) : MOIS[brut.slice(0, 3).toLowerCase()] ?? 1;
  const jour = Number(texte(premiere(fragment, 'Day')?.contenu)) || 1;
  return `${an}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/**
 * Un <PubmedArticle> en article normalisé — mêmes champs que `normaliser`
 * (fetch.mjs), pour que le classement et le registre ne voient aucune
 * différence entre les deux origines. Même règle aussi : sans abstract
 * exploitable, l'article est écarté.
 */
export function normaliserPubmed(bloc) {
  const citation = premiere(bloc, 'MedlineCitation')?.contenu ?? bloc;
  const article = premiere(citation, 'Article')?.contenu ?? '';
  // La liste de références (dans PubmedData) porte aussi des DOI et des PMID :
  // on ne cherche les identifiants de l'article qu'avant elle.
  const donnees = (premiere(bloc, 'PubmedData')?.contenu ?? '').split('<ReferenceList')[0];

  const pmid = texte(premiere(citation, 'PMID')?.contenu);
  const titre = texte(premiere(article, 'ArticleTitle')?.contenu).replace(/\s*\.\s*$/, '');
  const resume = toutes(premiere(article, 'Abstract')?.contenu ?? '', 'AbstractText')
    .map(({ attrs, contenu }) => {
      const etiquette = attr(attrs, 'Label');
      const t = texte(contenu);
      return etiquette && t ? `${etiquette}: ${t}` : t;
    })
    .filter(Boolean)
    .join(' ');
  if (!pmid || !titre || resume.length < 120) return null;

  const revue = premiere(article, 'Journal')?.contenu ?? '';
  const journal = texte(premiere(revue, 'Title')?.contenu);
  const doiArticle = toutes(article, 'ELocationID').find((e) => attr(e.attrs, 'EIdType') === 'doi');
  const ids = toutes(donnees, 'ArticleId');
  const doi = texte(doiArticle?.contenu) || texte(ids.find((e) => attr(e.attrs, 'IdType') === 'doi')?.contenu) || null;
  const pmc = texte(ids.find((e) => attr(e.attrs, 'IdType') === 'pmc')?.contenu);

  const auteurs = toutes(premiere(article, 'AuthorList')?.contenu ?? '', 'Author')
    .map(({ contenu }) => texte(premiere(contenu, 'CollectiveName')?.contenu) ||
      [texte(premiere(contenu, 'LastName')?.contenu), texte(premiere(contenu, 'Initials')?.contenu)].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ');

  // Europe PMC donne la première date de parution (électronique ou papier) :
  // on prend de même la plus ancienne des deux.
  const electronique = toutes(article, 'ArticleDate').map((d) => lireDate(d.contenu));
  const papier = lireDate(premiere(revue, 'PubDate')?.contenu);
  const entrez = toutes(donnees, 'PubMedPubDate').find((d) => attr(d.attrs, 'PubStatus') === 'entrez');
  const dates = [...electronique, papier].filter(Boolean).sort();
  const date = dates[0] ?? lireDate(entrez?.contenu);

  return {
    id: `pmid:${pmid}`,
    pmid,
    doi,
    titre,
    resume,
    journal,
    journalAbrege: texte(premiere(revue, 'ISOAbbreviation')?.contenu) ||
      texte(premiere(citation, 'MedlineTA')?.contenu) || journal,
    auteurs,
    date,
    types: toutes(premiere(article, 'PublicationTypeList')?.contenu ?? '', 'PublicationType')
      .map((t) => texte(t.contenu).toLowerCase())
      .filter(Boolean),
    langue: texte(premiere(article, 'Language')?.contenu) || 'eng',
    accesLibre: Boolean(pmc),
    citations: 0,
    liens: {
      pubmed: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      doi: doi ? `https://doi.org/${doi}` : null,
      europepmc: `https://europepmc.org/article/MED/${pmid}`,
    },
  };
}

/** Une réponse efetch entière → articles normalisés (les livres et les articles sans abstract sont écartés). */
export function analyserXml(xml) {
  return toutes(String(xml), 'PubmedArticle').map((b) => normaliserPubmed(b.contenu)).filter(Boolean);
}
