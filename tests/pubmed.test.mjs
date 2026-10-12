// PubMed en direct — traduction des requêtes, lecture de l'XML, décision de la sonde.
// Aucun appel réseau : tout se joue sur des chaînes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traduireRequete, analyserXml, europePmcEnRetard } from '../src/pubmed.mjs';
import { sujetDepuisThemes } from '../src/vocabulaire.mjs';

test('les champs Europe PMC deviennent des étiquettes PubMed', () => {
  assert.equal(
    traduireRequete('(TITLE_ABS:diabet* OR TITLE_ABS:"GLP-1") AND PUB_TYPE:"Meta-Analysis"'),
    '(diabet*[tiab] OR "GLP-1"[tiab]) AND "Meta-Analysis"[pt]',
  );
  assert.equal(traduireRequete('(LANG:eng OR LANG:fre)'), '(eng[la] OR fre[la])');
  assert.equal(traduireRequete('JOURNAL:"Annales d\'endocrinologie"'), '"Annales d\'endocrinologie"[journal]');
  assert.equal(traduireRequete('JOURNAL:"Lancet" AND HAS_ABSTRACT:Y'), '"Lancet"[journal] AND hasabstract');
});

test('un champ sans équivalent fait échouer la traduction au lieu d’élargir la requête', () => {
  assert.throws(() => traduireRequete('TITLE_ABS:thyroid* AND SRC:MED'), /SRC/);
  assert.throws(() => traduireRequete('HAS_ABSTRACT:N'), /HAS_ABSTRACT/);
});

test('la requête fabriquée depuis les thèmes se traduit entièrement', () => {
  const { sujet } = sujetDepuisThemes({
    Diabète: ['diabet', 'insulin resistance', 'glp-1'],
    Thyroïde: ["graves' disease", 'tsh'],
  });
  const t = traduireRequete(`${sujet} AND (LANG:eng OR LANG:fre)`);
  assert.equal(t, '(diabet*[tiab] OR "insulin resistance"[tiab] OR "glp-1"[tiab] OR "graves\' disease"[tiab] OR tsh*[tiab]) AND (eng[la] OR fre[la])');
  assert.doesNotMatch(t, /[A-Z_]{2,}:/);
});

const ARTICLE = `<?xml version="1.0" ?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2025//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_250101.dtd">
<PubmedArticleSet>
<PubmedArticle><MedlineCitation Status="PubMed-not-MEDLINE" Owner="NLM"><PMID Version="1">42850211</PMID>
<Article PubModel="Print-Electronic"><Journal><ISSN IssnType="Electronic">1945-7197</ISSN><JournalIssue CitedMedium="Internet"><Volume>111</Volume><PubDate><Year>2026</Year><Month>Nov</Month></PubDate></JournalIssue><Title>The Journal of clinical endocrinology and metabolism</Title><ISOAbbreviation>J Clin Endocrinol Metab</ISOAbbreviation></Journal>
<ArticleTitle>Tirzepatide <i>versus</i> semaglutide in adults with type&#xa0;2 diabetes &amp; obesity.</ArticleTitle>
<ELocationID EIdType="pii" ValidYN="Y">dgae123</ELocationID><ELocationID EIdType="doi" ValidYN="Y">10.1210/clinem/dgae123</ELocationID>
<Abstract><AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Incretin therapies differ in weight and glycaemic effects in adults with type 2 diabetes.</AbstractText><AbstractText Label="RESULTS" NlmCategory="RESULTS">HbA1c fell by 2.1% versus 1.8% (95% CI 0.1 to 0.5; <i>p</i>&lt;0.001) over 40 weeks.</AbstractText></Abstract>
<AuthorList CompleteYN="Y"><Author ValidYN="Y"><LastName>Dupont</LastName><ForeName>Marie</ForeName><Initials>M</Initials></Author><Author ValidYN="Y"><CollectiveName>SURPASS Investigators</CollectiveName></Author></AuthorList>
<Language>eng</Language><PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType><PublicationType UI="D016449">Randomized Controlled Trial</PublicationType></PublicationTypeList>
<ArticleDate DateType="Electronic"><Year>2026</Year><Month>10</Month><Day>07</Day></ArticleDate></Article>
<MedlineJournalInfo><MedlineTA>J Clin Endocrinol Metab</MedlineTA></MedlineJournalInfo>
<CommentsCorrectionsList><CommentsCorrections RefType="CommentIn"><RefSource>Ann Intern Med</RefSource><PMID Version="1">40000001</PMID></CommentsCorrections></CommentsCorrectionsList></MedlineCitation>
<PubmedData><History><PubMedPubDate PubStatus="entrez"><Year>2026</Year><Month>10</Month><Day>8</Day></PubMedPubDate></History>
<ArticleIdList><ArticleId IdType="pubmed">42850211</ArticleId><ArticleId IdType="pmc">PMC9999999</ArticleId></ArticleIdList>
<ReferenceList><Reference><Citation>Other paper.</Citation><ArticleIdList><ArticleId IdType="doi">10.1000/autre</ArticleId></ArticleIdList></Reference></ReferenceList></PubmedData></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">42850210</PMID><Article><Journal><Title>Thyroid</Title><JournalIssue><PubDate><MedlineDate>2026 Sep-Oct</MedlineDate></PubDate></JournalIssue></Journal>
<ArticleTitle>Erratum.</ArticleTitle></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1089/thy.x</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
</PubmedArticleSet>`;

test('un article PubMed a les mêmes champs qu’un article Europe PMC', () => {
  const [a, ...reste] = analyserXml(ARTICLE);
  assert.equal(reste.length, 0, 'l’erratum sans abstract est écarté');
  assert.equal(a.id, 'pmid:42850211');
  assert.equal(a.pmid, '42850211');
  assert.equal(a.titre, 'Tirzepatide versus semaglutide in adults with type 2 diabetes & obesity');
  assert.match(a.resume, /^BACKGROUND: Incretin/);
  assert.match(a.resume, /RESULTS: HbA1c fell by 2\.1% versus 1\.8% \(95% CI 0\.1 to 0\.5; p <0\.001\)/);
  assert.equal(a.journal, 'The Journal of clinical endocrinology and metabolism');
  assert.equal(a.journalAbrege, 'J Clin Endocrinol Metab');
  assert.equal(a.auteurs, 'Dupont M, SURPASS Investigators');
  assert.equal(a.date, '2026-10-07', 'la plus ancienne des dates de parution (électronique ici)');
  assert.deepEqual(a.types, ['journal article', 'randomized controlled trial']);
  assert.equal(a.langue, 'eng');
  assert.equal(a.accesLibre, true);
  assert.equal(a.doi, '10.1210/clinem/dgae123', 'jamais le DOI d’une référence citée');
  assert.equal(a.liens.pubmed, 'https://pubmed.ncbi.nlm.nih.gov/42850211/');
  assert.equal(a.liens.doi, 'https://doi.org/10.1210/clinem/dgae123');
});

test('le DOI se lit dans la liste d’identifiants quand l’article n’en porte pas', () => {
  const xml = ARTICLE.replace(/<ELocationID EIdType="doi"[^<]*<\/ELocationID>/, '')
    .replace('<ArticleId IdType="pmc">', '<ArticleId IdType="doi">10.1210/bis</ArticleId><ArticleId IdType="pmc">');
  assert.equal(analyserXml(xml)[0].doi, '10.1210/bis');
});

test('la sonde : Europe PMC en retard seulement face à un volume PubMed significatif', () => {
  // Du 9 au 11 octobre 2026 : 24 articles sur Europe PMC, des milliers sur PubMed.
  assert.equal(europePmcEnRetard({ europepmc: 24, pubmed: 9000 }), true);
  // Un rythme d'indexation simplement différent n'est pas un retard.
  assert.equal(europePmcEnRetard({ europepmc: 7200, pubmed: 9000 }), false);
  // Trop peu d'articles PubMed pour conclure (jours fériés, panne du NCBI) : on ne bascule pas.
  assert.equal(europePmcEnRetard({ europepmc: 0, pubmed: 300 }), false);
  assert.equal(europePmcEnRetard({ europepmc: NaN, pubmed: 9000 }), false);
});
