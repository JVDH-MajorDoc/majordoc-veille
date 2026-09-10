# MajorDoc

Un board de veille bibliographique, pensé comme page d'accueil du navigateur d'un
médecin. Chaque matin il parcourt les publications de la spécialité, garde les plus
solides, et en rédige des fiches de lecture structurées **en français**.

Spécialité configurée : **Endocrinologie – Diabétologie – Nutrition**.
Tout est paramétré dans `config.json` — c'est le seul fichier à reprendre pour une
autre spécialité.

---

## Destination et limites

MajorDoc est un **outil de veille bibliographique**. Il sert à décider quoi lire.

- Il ne traite **aucune donnée de patient** : rien n'entre dans le programme que des flux
  bibliographiques publics, et il n'existe aucun champ de saisie, aucun import, aucune
  connexion à un logiciel métier.
- Il ne produit **aucune sortie spécifique à un patient** : la veille du jour est la même
  pour tous ses lecteurs. Les préférences de thèmes réordonnent l'affichage, elles ne
  retirent jamais une publication.
- Les fiches sont **rédigées automatiquement à partir des résumés publiés**. Elles ne
  remplacent pas la lecture de l'article ou du texte de référence, dont le lien figure sur
  chaque fiche, et n'engagent aucune décision clinique.
- Une fiche de recommandation **rapporte ce que le texte demande** ; elle ne prescrit rien
  en son nom propre.

À ce titre il relève de la catégorie « *scientific literature* » que le guide européen
[MDCG 2019-11](https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf)
exclut explicitement de la définition du logiciel-dispositif médical, et il ne satisfait
pas l'étape 4 de la qualification (« *is the action for the benefit of individual
patients?* »). Toute évolution qui ferait entrer des données de patients, ou produirait une
sortie propre à un patient, changerait cette analyse de fond en comble.

Deux garde-fous vont dans le même sens et méritent d'être connus avant usage. **Les
chiffres sont vérifiés** : chaque nombre écrit dans une fiche est comparé au résumé
d'origine, et ceux qui ne s'y retrouvent pas sont signalés sur la fiche même. **La matière
disponible est déclarée** : une fiche établie à partir du seul titre le dit.

Ce n'est pas un dispositif médical, ce n'est pas un outil d'aide à la décision, et il ne
doit être présenté ni comme l'un ni comme l'autre.

---

## Le pipeline

```
HAS · SFE · SFD · RecoMédicales       flux RSS des organismes français
        ↓  filtre endocrino, registre des déjà-vus
        ↓
Europe PMC (MEDLINE / PubMed)         ~250 à 500 articles bruts
  + Annales d'Endocrinologie (SFE)
        ↓  dédoublonnage
        ↓  score : type d'étude, revue, fraîcheur, recoupement des requêtes
        ↓  sélection des 15 meilleurs, 5 par thème et 2 par revue au maximum
  API Claude                          fiches structurées + l'édito du jour
        ↓
  site/                               un dossier statique à déposer sur un serveur
```

Les **recommandations françaises** ouvrent le board, avant la littérature : une
actualisation de la HAS pèse plus lourd qu'un essai de phase 3. Elles ont leur propre
fiche, centrée sur « ce qui change ».

Un **registre** (`data/deja-vus.json`) retient tout ce qui a déjà été publié dans un
digest, recommandations comme articles. Sans lui, une recommandation ressortirait
chaque matin pendant les mois où elle reste dans le flux de son organisme, et un
article PubMed trois matins de suite tant qu'il est dans la fenêtre glissante — refiché,
donc repayé, à chaque fois. Rétention : 400 jours. `--oublier` remet le compteur à zéro.

Ces organismes n'exposant pas d'API, MajorDoc lit leurs flux RSS. Comme ces adresses
vieillissent mal, la résolution se fait en trois temps, sans intervention : l'adresse
connue, puis les flux déclarés dans le HTML de la page, puis un **sondage** des
identifiants internes présents dans la page (c'est ce qui permet de retrouver les flux
de la HAS, qu'un script construit et qu'aucune balise ne déclare). Un garde-fou
`flux_titre_attendu` refuse au passage tout flux qui répond sans être le bon — le flux
anglais de la HAS, par exemple. `npm run flux --tout` contrôle l'ensemble et montre ce
que les filtres écartent.

**Pourquoi Europe PMC plutôt que les E-utilities de NCBI ?** C'est le miroir européen
officiel de MEDLINE : mêmes articles, mêmes PMID, mais le résumé arrive dès la requête
de recherche. Un appel au lieu de deux, du JSON au lieu du XML, pas de clé, pas de
quota. Les liens PubMed sont générés normalement. Les *Annales d'Endocrinologie* y
sont indexées, donc la revue de la SFE passe par le même canal, avec une fenêtre de
60 jours puisqu'elle est mensuelle.

**Ce que l'audit du 13 août 2026 a appris.** Une praticienne a relu les quarante
premiers articles d'une journée et en a réclamé deux qui étaient tombés juste sous
la limite. Le réflexe — relever le plafond — n'aurait ramené que le premier. La
cause était ailleurs : le classement lui-même. Trois défauts se cumulaient, tous
corrigés depuis. Le thème était déduit du nombre d'occurrences dans tout le texte,
si bien que « Diabète », le mieux doté en vocabulaire, absorbait un essai de
surrénalectomie et lui disputait son quota — on compte désormais des termes
distincts, en donnant la priorité au titre. Aucune revue ne peut plus prendre plus
de deux places : trois articles du même journal le même matin, c'est un sommaire,
pas une veille. Enfin les revues Cochrane, absentes de la liste des journaux
prioritaires, sortaient au rang 17 ; la meilleure synthèse de la journée était
invisible. Après correction, les deux articles réclamés sont fichés et la revue
Cochrane ouvre la journée.

**Un arbitrage de rareté, pas un jugement de qualité.** `journaux_penalises`
relègue quelques revues à très gros volume — PLoS One, Scientific Reports, Cureus,
Medicine, les Frontiers. Elles publient du travail honnête, mais rarement ce qui
change une consultation, et chaque place qu'elles prennent dans les douze du jour
est enlevée à une revue de spécialité. Le bloc est un réglage, pas une doctrine :
le vider ne casse rien.

**Le sujet doit être annoncé dans le titre.** Chercher dans le résumé est
nécessaire : beaucoup d'articles pertinents ne nomment la maladie qu'au fil du
texte. Mais l'inverse existe aussi — une méta-analyse sur le gingembre et la
tension artérielle mentionne « nutrition » dans son résumé sans concerner une
endocrinologue une seule seconde. Un article dont le titre ne porte aucun mot de
la spécialité n'est pas écarté, il est relégué de quatre points, ce qui suffit
quand un millier de candidats se disputent douze places. Réglé sur les douze
articles réellement sortis le 13 août 2026 : la règle relègue les trois hors-sujet
et conserve les neuf autres.

**Un seul vocabulaire.** La liste `themes` de `config.json` sert à deux choses :
construire la requête envoyée à Europe PMC, et ranger les fiches trouvées dans les
rubriques du board. Ces deux usages ont divergé jusqu'au 13 août 2026 — le board
savait classer une fiche « Surrénale » alors qu'aucune requête ne pouvait en
trouver une, puisque ni Cushing, ni Addison, ni cortisol n'y figuraient. Une source
qui déclare `"sujet": "themes"` tire désormais sa requête de cette liste
(`src/vocabulaire.mjs`) : un mot ajouté à un thème étend du même geste ce qu'on
cherche et la façon dont c'est classé. Quelques termes sont volontairement gardés
pour le classement seul — « fracture » range bien une fiche, mais chercherait
toute la traumatologie ; `npm run diag -- --couverture` les liste et mesure ce que
chaque thème rapporte.

**Un mot sur la syntaxe des requêtes.** Europe PMC ne reconnaît pas le champ
`MESH:`. Interrogé dessus, il ne renvoie pas d'erreur : il retombe silencieusement
sur une recherche en texte libre, qui ramène un résultat plausible mais sans rapport
avec l'indexation MeSH. Deux des quatre requêtes ont vécu ainsi jusqu'au 13 août 2026,
l'une d'elles ne ramenant qu'un seul article dans toute la base. Le sujet est
désormais cherché avec `TITLE_ABS:`, mesuré et vérifiable : `npm run diag -- --champs`
compare les syntaxes candidates sur des compteurs réels. Leçon générale : sur cette
API, un compteur bas se lit comme une panne, pas comme une actualité calme.

Chaque fiche contient : titre traduit, accroche chiffrée, contexte, méthode, résultats,
conclusion, **pour la pratique**, limites, niveau de preuve dans l'esprit GRADE, et une
note d'intérêt clinique sur 5 qui détermine l'ordre d'affichage.

**Lu au pouce, entre deux consultations.** La veille se consulte surtout sur
iPhone et iPad, ce qui impose trois contraintes que le rendu de bureau ne révèle
pas. Un champ de saisie sous 16 px déclenche le zoom automatique d'iOS à la mise
au point — et la page reste zoomée ensuite : c'est la friction la plus coûteuse
de toutes. Une cible tactile sous 40 px se rate une fois sur trois quand on
marche. Et le bandeau étant collant, chaque rangée qu'il occupe est prise au
texte pour de bon : il en faisait trois sur iPhone, soit un quart de l'écran ;
il en fait deux, la commande « Tout déplier » se réduisant à son icône. Les
panneaux tiennent dans la hauteur visible, défilent sans emporter la page, et
leur bouton de fermeture reste sous le pouce. Ces réglages ont été vérifiés à la
main sur iPhone SE, iPhone 13, 13 Pro Max et iPad. Une icône d'écran d'accueil
permet enfin d'épingler le board comme une application.

**Le coût du jour est affiché en euros.** Le pied de page annonçait des tokens,
unité qui ne dit rien à personne. Le tarif du modèle vit dans `config.json`
(`anthropic.tarif`) : à ajuster si les prix changent, à supprimer pour revenir
aux tokens seuls.

**Chaque praticienne règle son ordre de lecture.** La sélection du matin est
commune au cabinet — quinze fiches, les mêmes pour tous — mais le bouton
« Mes thèmes » du bandeau permet à chacune de suivre de près certains thèmes
(ils ouvrent son board, marqués d'une étoile) et d'en mettre d'autres en
retrait (ils descendent en fin de page, estompés sous un séparateur explicite,
jamais supprimés : la transparence sur ce qui est paru fait partie du contrat).
Le réglage est propre au navigateur — à refaire une fois par poste. C'est la
première marche de la personnalisation ; les suivantes (votes par fiche,
pondération apprise) demanderont un point d'écriture côté serveur et
attendent le retour d'usage.

**Les échecs de génération ne sont plus silencieux.** Une fiche qui échoue
(rate limit, réseau) est retentée une fois, en série ; ce qui échoue encore
est compté et affiché au pied du board — « N fiches n'ont pas pu être
générées » — et les articles concernés, non marqués au registre, se
représentent d'eux-mêmes au passage suivant. Côté exploitant, `OnFailure=`
déclenche une notification (ntfy ou mail, cf. INSTALLATION.md) : la panne
se lit sur le téléphone, pas dans un message des lectrices trois jours après.
Un verrou (`data/run.lock`) empêche par ailleurs deux générations simultanées
de se marcher dessus.

**Les chiffres sont vérifiés.** Chaque nombre écrit dans une fiche est comparé au
résumé d'origine — après normalisation des virgules décimales, des séparateurs de
milliers et des arrondis. Ceux qui ne s'y retrouvent pas sont listés sur la fiche.
Un intervalle de confiance inventé est indétectable à la lecture, et c'est justement
le genre de valeur qu'un médecin retient : le contrôle signale, il ne corrige rien.
Deux pièges valaient d'être traités. Le premier est la virgule : « 0,931 » est une
décimale française, « 12,480 » un millier anglais, et les deux se ressemblent. Plutôt
que de trancher, chaque nombre est lu dans toutes ses interprétations plausibles et
deux nombres concordent dès qu'une lecture de l'un rejoint une lecture de l'autre.
Le second est le signe : la comparaison porte sur la valeur absolue, parce que le
résumé anglais écrit « fell by 2.1% » quand la fiche écrit « −2,1 % ». Contrepartie
assumée : une inversion de signe seule échapperait au filet.

Le prompt impose la fidélité stricte au résumé publié : pas de chiffre inventé, pas de
superlatif, signalement du financement industriel quand il apparaît. « Ne change rien
pour l'instant » est une conclusion valide et attendue.

---

## Démarrer

Prérequis : **Node.js 18 ou plus** (`node --version`). Aucune dépendance à installer.

```bash
cd majordoc

# 1. Voir le rendu tout de suite, sans clé et sans réseau
npm run demo && npm run preview        # http://localhost:4173

# 2. Vérifier que les sources répondent — gratuit, aucun appel à l'IA
npm run test-sources

# 3. Renseigner la clé API
cp .env.exemple .env                   # puis ANTHROPIC_API_KEY=sk-ant-...
                                       # https://console.anthropic.com/settings/keys

# 4. La vraie veille du jour
npm run digest && npm run preview
```

Pour mettre en ligne :

- **[INSTALLATION.md](INSTALLATION.md)** — la procédure pas à pas sur un CT Proxmox,
  du conteneur vide au HTTPS qui se met à jour tout seul. C'est le document à suivre.
- **[DEPLOIEMENT.md](DEPLOIEMENT.md)** — les autres cas : hébergement mutualisé
  Infomaniak par FTP, génération locale et publication à distance, fichier autonome.

---

## Commandes

| Commande | Effet |
|---|---|
| `npm run digest` | Veille du jour, met à jour `site/` |
| `npm run test-sources` | Récupère et classe, affiche la sélection — **sans appel IA, donc gratuit** |
| `npm run flux` | Teste les flux HAS / SFE / SFD et affiche ce qu'ils renvoient |
| `npm run flux -- https://un-site.fr` | Cherche les flux RSS déclarés par un site |
| `npm run demo` | Site d'exemple, hors ligne |
| `npm run preview` | Serveur local sur le port 4173 |
| `npm run autonome` | Produit en plus `board.html`, fichier unique à envoyer par mail |
| `node src/run.mjs --jours 7` | Fenêtre de 7 jours — utile le lundi ou après des congés |
| `node src/run.mjs --max 20` | 20 fiches au lieu de 12 |
| `node src/run.mjs --sans-recos` | Sauter les sources françaises |
| `node src/run.mjs --oublier` | Vider le registre : les recommandations déjà vues redeviennent neuves |
| `node src/run.mjs --out /var/www/veille` | Écrire le site ailleurs |

---

## Le board

Direction éditoriale de revue médicale : Newsreader pour la voix, Inter pour
l'appareil critique, bleu de Prusse et ocre sur papier chaud. Les polices sont
auto-hébergées — aucun appel à un CDN, donc aucune donnée de navigation qui fuit.

- **La une** — l'édito du jour, ce qu'il faut retenir en quatre lignes, et l'article
  à lire en premier si on n'en lit qu'un.
- **Sommaire latéral** avec suivi de lecture pendant le défilement.
- **Échelle de preuve** à quatre barreaux sur chaque article, dans l'esprit GRADE ;
  marqueur « fort intérêt » distinct, parce que la solidité d'une étude et son
  utilité en consultation sont deux choses différentes.
- **L'accroche** en gros, détachée : la seule chose à lire en trois secondes.
- **Fiche de lecture** dépliable, avec l'encadré « pour la pratique » en évidence.
- **Mis de côté** — le signet range une fiche dans une vue à part, avec son contenu
  recopié dans le navigateur : elle reste lisible des mois plus tard, même quand sa
  journée d'origine est loin derrière.
- **Archives** — les flèches `‹` `›` passent d'une journée à l'autre ; un clic sur la date
  ouvre l'ensemble des journées publiées, groupées par mois, avec le titre de chacune et
  un filtre. Une liste déroulante devenait illisible passé quelques semaines : le geste
  courant (« hier », « avant-hier ») mérite deux flèches, le geste rare mérite un panneau.
  Une recherche peut aussi être relancée sur tout l'historique.
- **Veille périmée** — au-delà de 48 heures sans génération (réglable par
  `fraicheur_alerte_heures`), un bandeau rouge l'annonce en tête de page. Une panne du
  timer ne doit pas passer pour un produit qui ne marche plus.
- **Clavier** : `/` rechercher · `J` `K` naviguer · `O` ouvrir · `L` lu · `G` garder ·
  `D` tout déplier · `?` aide.
- Clair / sombre automatique, responsive jusqu'au mobile, impression propre
  (Cmd-P donne une revue de presse en PDF).

---

## Adapter à une autre spécialité

Dans `config.json` :

- **`sources[]`** — chaque entrée est une requête [Europe PMC](https://europepmc.org/searchsyntax).
  Champs utiles : `MESH:"…"`, `JOURNAL:"…"`, `TITLE_ABS:…`, `PUB_TYPE:"…"`, `LANG:…`.
  `poids` fixe l'importance de la source dans le score, `fenetre_jours` sa profondeur.
- **`themes`** — les rubriques du board et leurs mots-clés déclencheurs.
- **`journaux_prioritaires`**, **`types_prioritaires`**, **`penalites`** — le barème du tri.
- **`max_articles_resumes`** — plafond de fiches, donc plafond de coût.

Côté code, deux endroits à reprendre dans `src/summarize.mjs` : la phrase
« Tu es un endocrinologue-diabétologue français » du prompt système, et la liste
`theme.enum` du schéma de fiche, qui doit refléter les mêmes rubriques que `themes`.

Pour la cardiologie par exemple : `MESH:"Cardiovascular Diseases"`, les revues
*Circulation*, *Eur Heart J*, *JACC*, et des thèmes Insuffisance cardiaque /
Rythmologie / Coronaire / Valvulopathies.

---

## Coût

Environ 1 000 tokens d'entrée et 500 de sortie par fiche, plus un petit appel pour
l'édito. Pour 12 fiches par jour, on reste de l'ordre de **quelques euros par mois**
sur Sonnet. Le compteur exact s'affiche en pied de board après chaque exécution, et
`npm run test-sources` permet de régler les requêtes sans rien dépenser.

---

## Ce que deviennent les journées passées

Chaque exécution écrit `site/data/AAAA-MM-JJ.json`, environ 25 Ko. **Rien n'est
supprimé** : 9 Mo par an, l'espace n'est pas le sujet. Toutes les journées figurent
dans `data/index.json` et restent accessibles par le sélecteur de date.

Trois façons de retrouver quelque chose d'ancien :

- le **sélecteur de date**, pour relire une journée entière ;
- **« Mis de côté »**, pour ce qu'on a signalé au passage — le contenu est recopié
  dans le navigateur, donc indépendant des fichiers d'archive ;
- la **recherche dans les archives** : tapez un mot, un lien propose alors de chercher
  dans toutes les journées archivées. Les fichiers sont lus à la demande.

Pour purger malgré tout, `jours_conservation` dans `config.json` : `0` conserve tout
(défaut), `365` supprime les journées de plus d'un an à la prochaine exécution.

---

## Structure

```
config.json           spécialité, sources, barème de tri
.env                  ANTHROPIC_API_KEY (jamais versionné, jamais envoyé au serveur)
src/fetch.mjs         client Europe PMC, normalisation
src/fr.mjs            flux RSS/Atom des organismes français, découverte, filtrage
src/registre.mjs      mémoire des publications déjà fichées (recos et articles)
src/verif.mjs         contrôle des chiffres de la fiche contre le résumé source
src/decouvrir.mjs     outil de test et de découverte des flux
deploy/alerte.sh      notification d'échec vers l'exploitant (ntfy/mail)
src/diagnostic.mjs    décompose les requêtes Europe PMC quand le compte tombe à 0
src/rank.mjs          score, détection de thème, sélection
src/summarize.mjs     API Claude — schémas de fiche et d'édito imposés
src/build.mjs         assemblage du site + archivage
src/run.mjs           orchestrateur en ligne de commande
src/preview.mjs       serveur local d'aperçu
src/theme/            l'interface : index.html, app.css, app.js, fonts/
src/demo.mjs          jeu de données d'exemple
tests/                tests unitaires (node:test, sans dépendance)
deploy/               systemd, nginx, envoi FTP/SSH, planification locale
site/                 généré — le dossier à déposer sur le serveur
```

---

## Tests

```bash
npm test
```

Trente-six tests, sans dépendance ni clé API, sur les mécanismes qu'une erreur
rendrait invisible : le contrôle des chiffres d'une fiche contre son résumé
source (virgule décimale contre séparateur de milliers, millésimes ignorés,
pourcentage écrit en fraction), la construction du vocabulaire de recherche
depuis `config.json`, le classement — le titre décide du thème, le résumé
départage — les quotas par thème et par revue, et le registre des publications
déjà fichées. Le même jeu tourne sur Node 18, 20 et 22 à chaque poussée, avec
le contrôle de syntaxe, `shellcheck` sur les scripts de déploiement et une
génération de démonstration complète.

---

## Limites à connaître

- Les fiches sont rédigées **à partir des résumés publiés**, pas du texte intégral.
  Elles servent à trier et à décider quoi lire ; elles ne remplacent pas l'article
  et n'engagent aucune décision clinique. Le board le dit explicitement en pied de page.
- Europe PMC indexe MEDLINE avec 24 à 72 h de décalage selon les éditeurs ; la fenêtre
  de 4 jours absorbe ce délai et le week-end.
- Les recommandations françaises passent par les flux RSS des organismes. Un texte
  publié sans passer par le flux (mise en ligne discrète, page isolée) sera manqué.
  L'identifiant du flux HAS change au fil des refontes du site : `npm run flux` le
  signale, et l'étape 6 d'INSTALLATION.md explique comment le récupérer en une minute.
- Les fiches de recommandation sont établies à partir du résumé du flux, complété par
  le texte de la page quand il est court. Le board indique explicitement quand une
  fiche repose sur peu de matière.
- Le niveau de preuve affiché est une appréciation automatique dans l'esprit de GRADE,
  pas une cotation GRADE formelle.
