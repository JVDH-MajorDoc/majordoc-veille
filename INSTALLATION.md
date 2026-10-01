# Installation de MajorDoc sur un CT Proxmox

Procédure complète, du conteneur vide au board en HTTPS qui se met à jour tout seul
chaque matin. Comptez **45 minutes** la première fois.

Chaque bloc de commandes est à copier-coller tel quel. Les valeurs à remplacer sont
en `MAJUSCULES`.

**Sommaire**

1. [Ce qu'il faut avoir sous la main](#1-ce-quil-faut-avoir-sous-la-main)
2. [Créer la clé API Anthropic](#2-créer-la-clé-api-anthropic)
3. [Créer le conteneur dans Proxmox](#3-créer-le-conteneur-dans-proxmox)
4. [Préparer le système](#4-préparer-le-système)
5. [Installer MajorDoc](#5-installer-majordoc)
6. [Vérifier les flux français](#6-vérifier-les-flux-français)
7. [Première génération](#7-première-génération)
8. [Servir le site avec nginx](#8-servir-le-site-avec-nginx)
9. [HTTPS](#9-https)
10. [Génération automatique chaque matin](#10-génération-automatique-chaque-matin)
11. [Restreindre l'accès](#11-restreindre-laccès-facultatif)
12. [Mettre en page d'accueil du navigateur](#12-mettre-en-page-daccueil-du-navigateur)
13. [Exploitation au quotidien](#13-exploitation-au-quotidien)
14. [Dépannage](#14-dépannage)
15. [Mettre à jour MajorDoc](#15-mettre-à-jour-majordoc)

---

## 1. Ce qu'il faut avoir sous la main

- Un accès à l'interface Proxmox (`https://IP-DU-SERVEUR:8006`)
- Un template Debian 12 dans le stockage `local` (sinon : *Datacenter → Storage →
  local → CT Templates → Templates*, chercher `debian-12-standard`)
- Un nom de domaine ou sous-domaine pointant vers votre IP publique, si vous voulez
  du HTTPS et un accès depuis l'extérieur — par exemple `veille.mondomaine.fr`
- Une carte bancaire pour la console Anthropic (comptez 2 à 5 € par mois)
- Le fichier `majordoc.zip`

Réservez une IP dans votre réseau, par exemple `192.168.1.50`. Elle sera utilisée
partout dans cette procédure sous le nom `IP-DU-CT`.

---

## 2. Créer la clé API Anthropic

1. Aller sur **https://console.anthropic.com** et créer un compte (ou se connecter).
2. **Settings → Billing → Add credits.** Créditer 10 € suffit pour plusieurs mois.
   Sans crédit, l'API renvoie une erreur `credit balance is too low`.
3. **Settings → API keys → Create key.** Nommer la clé `majordoc-ct`.
4. **Copier la clé immédiatement** : elle commence par `sk-ant-api03-…` et ne sera
   plus jamais affichée. La coller quelque part de sûr le temps de l'installation.

Recommandé : **Settings → Limits**, fixer un plafond mensuel (*monthly spend limit*)
à 10 €. C'est le garde-fou en cas de boucle imprévue.

> La clé donne accès à un compte payant. Elle ne doit jamais être commitée dans git
> ni copiée dans le dossier `site/`. La procédure ci-dessous la place dans un fichier
> `.env` en `chmod 600`, lisible par le seul utilisateur `majordoc`.

---

## 3. Créer le conteneur dans Proxmox

Dans l'interface Proxmox, **Create CT** :

| Onglet | Réglage |
|---|---|
| General | Hostname `majordoc` · décocher *Unprivileged container* : **non**, laisser coché (non privilégié, c'est bien) · mot de passe root |
| Template | `debian-12-standard` |
| Disks | **8 Go** — largement suffisant |
| CPU | **1 cœur** |
| Memory | **1024 Mo** de RAM, 512 Mo de swap |
| Network | IPv4 statique `IP-DU-CT/24`, passerelle = l'IP de votre box |
| DNS | Laisser hériter de l'hôte |

Cocher **Start after created**, puis *Finish*.

Ouvrir ensuite la console du CT (bouton *>_ Console*) et se connecter en `root`.

Si vous préférez la ligne de commande, depuis l'hôte Proxmox :

```bash
pct create 120 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname majordoc \
  --cores 1 --memory 1024 --swap 512 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=IP-DU-CT/24,gw=IP-DE-VOTRE-BOX \
  --features nesting=1 \
  --unprivileged 1 --onboot 1 --start 1
pct enter 120
```

---

## 4. Préparer le système

Dans le conteneur, en root :

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg unzip nginx rsync
```

Installer Node.js 22 (la version de Debian est trop ancienne) :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version        # doit afficher v22.x
```

Créer l'utilisateur de service — MajorDoc ne tournera jamais en root :

```bash
adduser --system --group --home /opt/majordoc --shell /usr/sbin/nologin majordoc
```

Fixer le fuseau horaire, sinon la tâche de 6h45 partira à la mauvaise heure :

```bash
timedatectl set-timezone Europe/Paris
timedatectl                     # vérifier "Local time" et "Time zone"
```

---

## 5. Installer MajorDoc

Depuis **votre Mac**, envoyer l'archive dans le conteneur :

```bash
scp majordoc.zip root@IP-DU-CT:/tmp/
```

Puis, **dans le conteneur** :

```bash
cd /tmp && unzip -q majordoc.zip
cp -r majordoc/. /opt/majordoc/
cd /opt/majordoc
rm -rf site board.html          # on repart d'un site propre
```

Créer le fichier de configuration secrète :

```bash
cat > /opt/majordoc/.env <<'EOF'
ANTHROPIC_API_KEY=sk-ant-api03-COLLEZ-VOTRE-CLE-ICI
# Pour être prévenu si la génération du matin échoue (section « Être prévenu
# en cas de panne ») — décommentez et adaptez :
# ALERTE_NTFY=https://ntfy.sh/majordoc-CHOISISSEZ-UN-SUJET-SECRET
# ALERTE_MAIL=vous@exemple.fr
EOF
```

Poser les droits — c'est l'étape qui protège la clé :

```bash
chown -R majordoc:majordoc /opt/majordoc
chmod 600 /opt/majordoc/.env
chmod 750 /opt/majordoc
```

Vérifier que tout est en place :

```bash
sudo -u majordoc -g majordoc node /opt/majordoc/src/run.mjs --demo
```

Vous devez voir `Site de démonstration : /opt/majordoc/site`. Si oui, Node et les
droits sont bons.

---

## 6. Vérifier les flux français

Les sociétés savantes et la HAS n'ont pas d'API : MajorDoc lit leurs flux RSS. Les
cinq adresses sont déjà renseignées et vérifiées. Cette étape ne sert qu'à contrôler
qu'elles répondent depuis votre réseau.

```bash
cd /opt/majordoc
sudo -u majordoc -g majordoc node src/decouvrir.mjs --tout
```

`--tout` affiche aussi ce que les filtres écartent : c'est le meilleur moyen de
vérifier qu'on ne jette rien d'utile, et de régler les mots-clés si besoin.

Vous devez voir cinq `✓`. **MajorDoc fonctionne même si une source échoue** : elle
apparaît en rouge dans le pied de page du board, sans bloquer le reste.

### Comment la HAS se résout toute seule

La HAS construit les liens de ses flux par un script : rien n'est visible dans le
HTML, donc la détection classique (`<link rel="alternate">`) ne peut pas les voir.
Trois mécanismes prennent le relais, dans cet ordre :

1. **L'adresse connue** — `Rss2.jsp?id=p_3081452` pour les recommandations,
   `p_3081656` pour les actualités. Vérifiées le 31 juillet 2026.
2. **Le sondage**, si ces identifiants cessent de répondre. La page des flux contient
   les identifiants JCMS en clair, même si les URL n'y sont pas : MajorDoc les
   collecte, interroge `Rss2.jsp?id=<identifiant>` pour chacun, et retient celui dont
   le titre du canal correspond à ce qu'on attend. C'est le champ `sonde` de
   `config.json`.
3. **Le garde-fou** `flux_titre_attendu` : un flux qui répond mais dont le titre ne
   correspond pas est refusé. C'est ce qui empêche de retomber sur le flux anglais de
   la HAS — il répond parfaitement, mais ne contient que des avis de transparence
   médicaments en anglais. Mieux vaut une source en rouge qu'une source silencieusement
   fausse.

Autrement dit : si la HAS renumérote ses flux, MajorDoc les retrouve au prochain
lancement sans que vous ayez à intervenir. L'adresse qui a fonctionné est mémorisée
dans `data/flux-resolus.json`.

### Régler le bruit

Les flux des sociétés savantes mélangent recommandations et vie associative :
webinaires, portraits, journées, appels à candidature. SFE, SFD et RecoMédicales
utilisent donc un **filtre positif sur le titre** (`"filtre_champ": "titre"`) : on ne
garde que ce qui ressemble à une recommandation ou nomme une pathologie
endocrinienne.

Si un sujet légitime est écarté, ajoutez le mot manquant dans `filtre_mots` de la
source. Si du bruit passe, ajoutez-le dans `exclure_mots`. Puis re-lancez
`node src/decouvrir.mjs --tout` : la section « écartés » montre l'effet immédiatement.

### Ajouter une source

```bash
sudo -u majordoc -g majordoc node src/decouvrir.mjs -- https://le-site-a-explorer.fr
```

La commande liste les flux que la page déclare et teste chacun. Toute adresse qui
répond se recopie dans un nouveau bloc de `sources_fr`.

## 7. Première génération

Un essai à blanc d'abord : il interroge toutes les sources, classe les articles et
affiche la sélection, **sans appeler l'IA — donc sans dépenser un centime**.

```bash
cd /opt/majordoc
sudo -u majordoc -g majordoc node src/run.mjs --dry-run
```

Vous devez voir les quatre sources PubMed répondre, les recommandations françaises
retenues, puis une douzaine d'articles avec leur score. Si tout est à zéro, allez
directement au [dépannage](#14-dépannage).

Puis la vraie génération :

```bash
sudo -u majordoc -g majordoc node src/run.mjs
```

Compter 1 à 3 minutes. La sortie se termine par :

```
  12 fiches · 2 recommandations · 21 480 tokens · 94.2 s
  Site à jour : /opt/majordoc/site  (1 journée en ligne)
```

---

## 8. Servir le site avec nginx

```bash
cp /opt/majordoc/deploy/nginx-majordoc.conf /etc/nginx/sites-available/majordoc
mkdir -p /etc/nginx/snippets
cp /opt/majordoc/deploy/nginx-majordoc-securite.conf /etc/nginx/snippets/majordoc-securite.conf
nano /etc/nginx/sites-available/majordoc
```

Le second fichier porte les en-têtes de sécurité, inclus par chaque bloc du site
(nginx n'hérite pas des en-têtes d'un niveau à l'autre dès qu'un bloc en déclare
un). Une fois HTTPS en place (§9), décommentez-y la ligne
`Strict-Transport-Security`.

Une seule ligne à changer : `server_name veille.example.org;` → votre domaine.
Si vous n'avez pas de domaine et restez en réseau local, mettez `server_name _;`.

Activer le site et désactiver la page par défaut :

```bash
ln -sf /etc/nginx/sites-available/majordoc /etc/nginx/sites-enabled/majordoc
rm -f /etc/nginx/sites-enabled/default
nginx -t                       # doit répondre "syntax is ok" puis "test is successful"
systemctl reload nginx
```

nginx doit pouvoir traverser `/opt/majordoc` pour atteindre `site/` :

```bash
chmod 755 /opt/majordoc
chmod -R 755 /opt/majordoc/site
```

Tester depuis votre Mac : **http://IP-DU-CT** doit afficher le board.

---

## 9. HTTPS

À faire seulement si le domaine pointe déjà vers votre IP publique et que les
ports 80 et 443 sont redirigés vers le CT sur votre box.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d veille.mondomaine.fr
```

Certbot demande une adresse mail, propose la redirection HTTP → HTTPS (accepter) et
installe le renouvellement automatique. Vérifier :

```bash
certbot renew --dry-run
```

---

## 10. Génération automatique chaque matin

```bash
cp /opt/majordoc/deploy/majordoc.service /etc/systemd/system/
cp /opt/majordoc/deploy/majordoc.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now majordoc.timer
```

Pour changer l'heure (6h45 par défaut) :

```bash
systemctl edit --full majordoc.timer      # modifier OnCalendar
systemctl daemon-reload && systemctl restart majordoc.timer
```

Vérifier que c'est armé :

```bash
systemctl list-timers majordoc.timer
```

`NEXT` doit afficher demain matin. `Persistent=true` fait rattraper l'exécution si le
conteneur était éteint à l'heure dite.

Déclencher une exécution tout de suite, pour valider la chaîne complète :

```bash
systemctl start majordoc.service
journalctl -u majordoc.service -f          # suivre en direct, Ctrl+C pour sortir
```

L'unité fournie tourne sous l'utilisateur `majordoc`, avec `ProtectSystem=strict` :
le service n'a le droit d'écrire que dans `/opt/majordoc/site`. Même compromis, il ne
peut pas toucher au reste du système.

---

## 11. Restreindre l'accès (facultatif)

Le board ne contient que des résumés d'articles publics — aucune donnée patient.
Si vous voulez tout de même le réserver à quelques personnes :

```bash
apt install -y apache2-utils
htpasswd -c /etc/nginx/.majordoc-users prenom.nom     # mot de passe demandé
htpasswd /etc/nginx/.majordoc-users autre.personne    # sans -c pour les suivants
```

Puis dans `/etc/nginx/sites-available/majordoc`, à l'intérieur du bloc `server { }` :

```nginx
auth_basic "MajorDoc";
auth_basic_user_file /etc/nginx/.majordoc-users;
```

```bash
nginx -t && systemctl reload nginx
```

Le `robots.txt` livré interdit déjà l'indexation par les moteurs de recherche.

---

## 12. Mettre en page d'accueil du navigateur

Sur le poste du médecin :

- **Chrome** — Réglages → *Au démarrage* → *Ouvrir une page ou un ensemble de pages
  spécifiques* → *Ajouter* → l'URL du board. Puis Réglages → *Apparence* → activer
  *Afficher le bouton Accueil* et y mettre la même URL.
- **Safari** — Réglages → *Général* → *La page d'accueil* → l'URL, et régler
  *Les nouvelles fenêtres s'ouvrent avec* sur *Page d'accueil*.
- **Firefox** — Réglages → *Accueil* → *Page d'accueil et nouvelles fenêtres* →
  *Adresses personnalisées*.
- **iPhone / iPad** — ouvrir l'URL dans Safari, bouton Partager → *Ajouter à l'écran
  d'accueil*. L'icône ouvre le board en plein écran.

---

## 13. Exploitation au quotidien

Une fois installé, il n'y a normalement rien à faire. Les commandes utiles, au cas où :

| Besoin | Commande (dans `/opt/majordoc`) |
|---|---|
| Voir la dernière exécution | `journalctl -u majordoc.service -n 60` |
| Relancer maintenant | `systemctl start majordoc.service` |
| Prochaine exécution prévue | `systemctl list-timers majordoc.timer` |
| Regénérer avec une fenêtre large | `sudo -u majordoc node src/run.mjs --jours 10` |
| Oublier les recommandations déjà vues | `sudo -u majordoc node src/run.mjs --oublier` |
| Tester les sources sans dépenser | `sudo -u majordoc node src/run.mjs --dry-run` |
| Re-vérifier les flux français | `sudo -u majordoc node src/decouvrir.mjs` |
| Suspendre la veille | `systemctl disable --now majordoc.timer` |

**Coût.** Le pied de page du board affiche le nombre de tokens de chaque exécution.
Comptez 20 000 à 30 000 tokens par jour, soit de l'ordre de 2 à 5 € par mois. La
consommation réelle se suit sur https://console.anthropic.com → *Usage*.

**Les journées passées.** Chaque matin écrit un fichier d'environ 25 Ko dans
`site/data/`. Rien n'est supprimé : comptez 9 Mo par an, et toutes les journées
restent consultables depuis le sélecteur de date du board, avec une recherche possible
sur l'ensemble de l'historique. Pour purger malgré tout, réglez `jours_conservation`
dans `config.json` (`0` = tout conserver, `365` = supprimer au-delà d'un an).



## Le coût quotidien, en euros

Le pied de page du board affiche le coût de la génération du matin. Le tarif
vit dans `config.json` :

```json
"tarif": { "entree_usd_mtok": 2, "sortie_usd_mtok": 10, "eur_usd": 0.86 }
```

Ce sont les prix de Claude Sonnet 5.5 par million de tokens et un taux de change. À
revoir si vous changez de modèle ou si les prix bougent ; supprimer le bloc
revient à l'affichage en tokens seuls. L'ordre de grandeur d'une journée à
quinze fiches est de quelques dizaines de centimes.

## Prévenir les lectrices chaque matin (facultatif)

Une fois la veille publiée, l'édito peut partir en notification sur les iPhone
du cabinet, et la toucher ouvre le board. Il faut l'application **ntfy**
(gratuite, sans compte) sur chaque téléphone, abonnée à un même sujet, puis
dans `/opt/majordoc/.env` :

```
NOTIF_NTFY=https://ntfy.sh/majordoc-veille-UN-NOM-LONG-ET-SECRET
MAJORDOC_URL=https://veille.mondomaine.fr
```

Prenez un sujet **différent** de celui des alertes de panne (`ALERTE_NTFY`
ci-dessous) : les lectrices n'ont pas à recevoir les journaux d'erreur. Un
matin sans nouveauté n'envoie rien, et une notification qui échoue ne fait
jamais échouer la veille.

## Être prévenu en cas de panne

Le board prévient déjà les **lectrices** quand la veille date (bandeau en haut de
page). Cette section prévient l'**exploitant** — vous — au moment même où une
génération échoue, plutôt que par un message du cabinet trois jours plus tard.

```bash
cp /opt/majordoc/deploy/majordoc-alerte.service /etc/systemd/system/
cp /opt/majordoc/deploy/majordoc.service /etc/systemd/system/   # ajoute OnFailure=
systemctl daemon-reload
```

Puis choisissez le canal dans `/opt/majordoc/.env` :

- **ntfy (recommandé, cinq minutes)** : installez l'application ntfy sur votre
  téléphone, abonnez-vous à un sujet au nom long et imprévisible (il fait office
  de mot de passe), et renseignez `ALERTE_NTFY=https://ntfy.sh/votre-sujet`.
- **mail** : `ALERTE_MAIL=vous@exemple.fr` — suppose une commande `mail`
  fonctionnelle sur le CT (mailutils + relais SMTP).

Testez sans attendre une panne :

```bash
systemctl start majordoc-alerte.service   # envoie une vraie notification
```

La notification contient les dernières lignes du journal : dans la plupart des
cas, la cause se lit sans même ouvrir une console.

**Sauvegarde.** Une sauvegarde Proxmox hebdomadaire du CT suffit (*Datacenter →
Backup → Add*). Les seuls fichiers non reproductibles sont `.env`, `config.json`
et `data/` (le registre des publications déjà fichées et les adresses de flux résolues).
Le dossier `site/data/` contient l'historique des journées publiées.

---

## 14. Dépannage

**« Clé API manquante »**
Le fichier `.env` n'est pas lu. Vérifier qu'il existe, qu'il appartient à `majordoc`
et qu'il ne contient pas de guillemets autour de la clé :
`cat /opt/majordoc/.env` puis `ls -l /opt/majordoc/.env`.

**« credit balance is too low »**
Il faut créditer le compte : console.anthropic.com → *Billing* → *Add credits*.

**« Aucun article récupéré » et toutes les sources en `✗ HTTP 403 / ENOTFOUND »**
Le conteneur n'a pas accès à Internet, ou pas de résolution DNS. Tester :
`ping -c2 1.1.1.1` puis `getent hosts www.ebi.ac.uk`. Si le ping passe mais pas le
DNS, corriger `/etc/resolv.conf`.

**Les sources PubMed répondent mais 0 article retenu**
Normal un lundi de pont ou après une panne d'indexation. Élargir :
`node src/run.mjs --jours 10`.

**La HAS reste en erreur**
Les deux mécanismes de secours ont échoué : soit le réseau bloque `has-sante.fr`,
soit la page des flux a changé de structure. Diagnostic :
`node src/decouvrir.mjs -- https://www.has-sante.fr/jcms/c_1771214/fr/nos-flux-d-information-rss`.
Le board fonctionne sans, la ligne apparaît en rouge dans son pied de page.

**Une source répond mais renvoie du contenu hors sujet ou en anglais**
`flux_titre_attendu` dans `config.json` est le garde-fou : il refuse un flux dont le
titre ne correspond pas. Ajustez l'expression, ou retirez l'adresse fautive de `flux`.

**Trop d'annonces de congrès et de webinaires dans les recommandations**
Ajouter les mots gênants dans `exclure_mots` de la source concernée, puis
`node src/decouvrir.mjs --tout` pour vérifier ce qui est écarté.

**Le board affiche « Aucun digest à afficher »**
Le fichier `site/data/index.json` est absent ou illisible par nginx.
`ls -l /opt/majordoc/site/data/` puis `chmod -R 755 /opt/majordoc/site`.

**nginx renvoie 403 Forbidden**
nginx ne peut pas traverser `/opt/majordoc`. `chmod 755 /opt/majordoc`.

**Le timer ne se déclenche pas à la bonne heure**
Fuseau horaire du conteneur. `timedatectl set-timezone Europe/Paris`, puis
`systemctl restart majordoc.timer`.

**`EROFS: read-only file system` en écrivant dans `data/`**
L'unité systemd restreint les écritures. Vérifiez que
`/etc/systemd/system/majordoc.service` contient bien `ReadWritePaths=/opt/majordoc`
(et non un sous-dossier seul), puis `systemctl daemon-reload` et relancez. Le service
écrit dans `site/` (le board publié) **et** dans `data/` (registre des publications
déjà vues, adresses de flux résolues).

**Toutes les sources françaises annoncent « 0 nouveauté »**
C'est presque toujours normal : les publications déjà fichées un jour précédent ne
ressortent pas, c'est tout l'intérêt du registre. `node src/decouvrir.mjs` affiche en
tête le nombre de publications déjà vues. Pour tout reprendre à zéro :

```bash
sudo -u majordoc -g majordoc node src/run.mjs --oublier
```

Si le registre est vide et que le compte reste à zéro, ce sont les filtres :
`node src/decouvrir.mjs --tout` montre ce qui est écarté et pourquoi.

**Un bandeau rouge annonce que la veille est périmée**
La génération n'a pas tourné depuis plus de 48 heures. `systemctl list-timers
majordoc.timer` et `journalctl -u majordoc.service -n 100` donnent la cause. Le seuil
se règle par `fraicheur_alerte_heures` dans `config.json`.

**Des fiches affichent « chiffres absents du résumé d'origine »**
C'est le contrôle automatique : les nombres écrits dans la fiche sont comparés au
résumé source. Un signalement occasionnel est normal — le modèle peut convertir une
unité ou calculer un pourcentage absent tel quel de l'abstract. Un signalement sur la
majorité des fiches, en revanche, indique un problème de prompt ou de modèle : à
regarder de près.

**Une exécution s'est mal passée, le board affiche encore hier**
C'est le comportement voulu : le site n'est écrasé qu'en cas de succès. Regarder
`journalctl -u majordoc.service -n 100` pour comprendre, puis relancer.

**Trop d'articles hors sujet, ou pas assez**
Tout se règle dans `config.json` : `sources[].query` pour les requêtes PubMed,
`max_articles_resumes` pour le volume, `journaux_prioritaires` et
`types_prioritaires` pour le barème de tri. Tester avec `--dry-run`, c'est gratuit.

---

## Lecture vocale (facultatif)

Le bouton *Écouter* fonctionne sans rien installer : il utilise la synthèse du
navigateur. C'est correct sur ordinateur. Sur iPhone et iPad, c'est médiocre, et
pour une raison qu'aucun réglage ne contourne : **Safari n'expose pas à la Web
Speech API les voix « Améliorée » et « Premium » d'Apple**, même téléchargées dans
Réglages → Accessibilité → Contenu énoncé. Il ne reste que les voix compactes.

Pour une voix naturelle sur mobile, le conteneur fabrique un MP3 par fiche à la
génération, avec Piper — synthèse neuronale locale, gratuite, sans réseau.

### Installer Piper et une voix française

```bash
apt install -y ffmpeg python3-venv
sudo -u majordoc -g majordoc python3 -m venv /opt/majordoc/venv
sudo -u majordoc -g majordoc /opt/majordoc/venv/bin/pip install piper-tts

# La voix, téléchargée par Piper lui-même (le modèle et son .json)
sudo -u majordoc -g majordoc mkdir -p /opt/majordoc/voix
sudo -u majordoc -g majordoc /opt/majordoc/venv/bin/python -m piper.download_voices \
  fr_FR-siwis-medium --download-dir /opt/majordoc/voix
```

Rien d'autre à installer : le wheel embarque espeak-ng et ses données, il n'y a
pas de paquet système à ajouter. Comptez environ **160 Mo** en tout — 85 Mo pour
onnxruntime et numpy dans le venv, 60 Mo pour le modèle.

### Choisir la voix, sans y passer la matinée

Piper propose sept voix françaises, et l'une d'elles en contient cent
vingt-cinq :

| modèle | ce qu'il vaut |
|---|---|
| `fr_FR-siwis-medium` | féminine, articulation très nette, un peu scolaire |
| `fr_FR-tom-medium` | masculine, plus chaude |
| `fr_FR-upmc-medium` | deux locuteurs (`-s 0` et `-s 1`) |
| **`fr_FR-mls-medium`** | **125 locuteurs** — c'est là qu'il y a le plus à trouver |
| `fr_FR-siwis-low`, `fr_FR-gilles-low` | plus rapides, moins fines |

Plutôt que de régénérer la veille à chaque essai, la planche d'écoute les
compare sur une même phrase — une phrase qui porte un décimal, un sigle, un mot
anglais et une incise, c'est-à-dire tout ce sur quoi une voix de synthèse
trébuche dans une vraie fiche :

```bash
cd /opt/majordoc
sudo -u majordoc -g majordoc node src/auditionner.mjs \
  voix/fr_FR-siwis-medium.onnx voix/fr_FR-tom-medium.onnx \
  --commande /opt/majordoc/venv/bin/piper

# Un modèle multi-voix : on échantillonne, on affine ensuite
sudo -u majordoc -g majordoc node src/auditionner.mjs voix/fr_FR-mls-medium.onnx \
  --locuteurs 0,10,20,30,40,50,60,70,80,90,100,110,120 \
  --commande /opt/majordoc/venv/bin/piper
```

Puis ouvrir `audition/index.html` — ou, depuis un autre poste :
`python3 -m http.server -d /opt/majordoc/audition 8080`.

Le gagnant se reporte dans `config.json` : `modele`, et `locuteur` pour un
modèle multi-voix. `longueur` au-dessus de 1 ralentit la diction, ce qui suffit
parfois à rendre une voix moins mécanique.

**Ce qu'il ne faut pas espérer.** Piper est rapide et gratuit, mais c'est une
synthèse de 2023 : les voix restent identifiables comme telles. Changer de voix
donne un autre timbre, pas un autre genre de voix. Si aucune ne convient, le
palier suivant n'est pas dans Piper — voyez la note du projet sur la lecture
vocale.

Si le téléchargement est bloqué par un pare-feu, les deux fichiers se prennent
directement :

```bash
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium
cd /opt/majordoc/voix
sudo -u majordoc -g majordoc curl -LO $BASE/fr_FR-siwis-medium.onnx
sudo -u majordoc -g majordoc curl -LO $BASE/fr_FR-siwis-medium.onnx.json
```

### Activer

Dans `config.json`, bloc `voix` :

```json
"voix": {
  "actif": true,
  "commande": "/opt/majordoc/venv/bin/piper",
  "modele": "voix/fr_FR-siwis-medium.onnx",
  "retention_jours": 7
}
```

`modele` est relatif à `/opt/majordoc` ; un chemin absolu marche aussi.

### Écouter le résultat sans dépenser un jeton

```bash
cd /opt/majordoc && time sudo -u majordoc -g majordoc node src/run.mjs --demo
```

La démonstration fabrique aussi l'audio. Ouvrez le board, dépliez une fiche,
cliquez *Écouter*. Si la voix ne vous convient pas, changez de modèle et
relancez : rien d'autre n'est à toucher.

Le `time` n'est pas décoratif : c'est la mesure de ce que la voix ajoutera au
passage du matin sur **votre** processeur. Dix fiches de démonstration donnent
l'ordre de grandeur des quinze fiches réelles. Si le résultat vous paraît long,
`fr_FR-siwis-low` synthétise plus vite, avec une voix moins fine.

### Ce que ça coûte

Une fiche lue fait une à deux minutes, soit 300 à 400 Ko en MP3 à 32 kb/s.
Quinze fiches par jour font donc **cinq à six mégaoctets par journée**, et
quelques minutes de processeur au passage du matin. C'est sans commune mesure
avec les 25 Ko de texte d'une journée : l'audio a pour cette raison sa propre
rétention, `retention_jours`, à sept par défaut. Les journées d'audio plus
anciennes sont supprimées à chaque génération ; les fiches, elles, restent.
Personne n'écoute la fiche du mois dernier.

### Si quelque chose manque

Rien ne casse. Piper absent, modèle introuvable, ffmpeg non installé : la
génération l'écrit dans le journal, continue, et le board lit avec la voix du
navigateur. Il en va de même pour une journée dont l'audio a été purgé. La
lecture vocale est un confort, pas une dépendance.

Pour la désactiver : `"actif": false`. Les fichiers déjà produits sont purgés par
la rétention, ou d'un coup :

```bash
rm -rf /opt/majordoc/site/data/audio
```

---

## 15. Mettre à jour MajorDoc

L'archive se télécharge depuis les **Releases** du dépôt GitHub. Pour en
publier une : onglet **Actions** → *Archive de mise à jour* → **Run workflow**
(ou pousser un tag `maj-AAAA-MM-JJ`). Elle n'est construite que si les tests
passent. Copiez-la dans `/tmp` du conteneur, puis deux commandes :

```bash
cd /tmp && rm -rf majordoc && unzip -q majordoc-maj-AAAA-MM-JJ.zip
bash /tmp/majordoc/deploy/mettre-a-jour.sh
```

Le script sauvegarde le code en place **avant** d'y toucher et affiche la
commande de retour en arrière ; il refuse d'avancer si les tests échouent,
plutôt que de laisser le timer republier un board cassé le lendemain matin ; il
signale les réglages nouveaux de `config.json` au lieu de compter sur un `diff`
qu'on oublie de lire ; et il ne touche jamais à `config.json`, `.env` ni
`data/`. Il ne demande ni git, ni réseau, ni dépôt distant.

Il s'arrête avant de publier : la dernière étape, qu'il affiche, reste à lancer
à la main. C'est volontaire — on regarde la veille avant de la republier.

### Configuration nginx (version d'octobre 2026)

La configuration nginx vit hors de `/opt/majordoc` : le script ne la touche pas.
Celle de cette version corrige deux défauts de la précédente — les fichiers
audio de la lecture vocale étaient servis comme du JSON (Safari refusait de les
lire), et les en-têtes de sécurité manquaient sur les données et les ressources.
Le script signale si elle n'a pas encore été reprise ; pour la reprendre :

```bash
cp /etc/nginx/sites-available/majordoc /root/majordoc-nginx.avant
cp /opt/majordoc/deploy/nginx-majordoc.conf /etc/nginx/sites-available/majordoc
mkdir -p /etc/nginx/snippets
cp /opt/majordoc/deploy/nginx-majordoc-securite.conf /etc/nginx/snippets/majordoc-securite.conf
nano /etc/nginx/sites-available/majordoc     # remettre votre server_name
certbot --nginx -d veille.mondomaine.fr      # si HTTPS : réinstalle le certificat existant
nginx -t && systemctl reload nginx
```

### Passage à Claude Sonnet 5.5 (avant le 24 novembre 2026)

Anthropic retire Claude Sonnet 4.5 le 24/11/2026 (disponibilité dégradée dès le
30/10). Comme le script ne réécrit jamais `config.json`, reportez à la main le
bloc `anthropic` de la nouvelle archive — le script le signale à l'étape 4 :

```json
"anthropic": {
  "model": "claude-sonnet-5-5",
  "effort": "low",
  "max_tokens": 8000,
  "repli_refus": "default",
  "concurrence": 4,
  "tarif": { "entree_usd_mtok": 2, "sortie_usd_mtok": 10, "eur_usd": 0.86 }
}
```

Oublier ce report ne casse rien : un `claude-sonnet-4-5` resté en place est
remplacé à l'exécution par `claude-sonnet-5-5`, avec un avertissement dans le
journal. Mais le coût affiché resterait calculé au tarif de Sonnet 4.5.

- `effort` règle la réflexion du modèle avant d'écrire : `low` suffit pour des
  fiches ; `medium` si elles manquent de finesse, au prix de plus de tokens.
- `max_tokens` inclut cette réflexion : ne pas redescendre sous 8000.
- `repli_refus` : si le modèle décline une demande (filtre de sécurité), l'API
  la rejoue d'elle-même sur un autre modèle. `null` pour désactiver.

Deux variables si l'installation n'est pas à l'endroit habituel :
`MAJORDOC_CIBLE` (défaut `/opt/majordoc`) et `MAJORDOC_UTILISATEUR`
(défaut `majordoc`).

### À la main, si l'on préfère voir chaque geste

```bash
systemctl stop majordoc.timer
cd /tmp && rm -rf majordoc && unzip -q majordoc-nouvelle-version.zip

# on préserve la configuration et l'historique
cp -r majordoc/src majordoc/tests /opt/majordoc/
cp majordoc/package.json majordoc/README.md majordoc/INSTALLATION.md /opt/majordoc/
cp -r majordoc/deploy /opt/majordoc/

chown -R majordoc:majordoc /opt/majordoc

# Deux contrôles avant de rouvrir le robinet : les tests ne demandent ni clé
# ni réseau, le dry-run vérifie que les sources répondent — sans rien dépenser.
cd /opt/majordoc && sudo -u majordoc -g majordoc npm test
sudo -u majordoc -g majordoc node /opt/majordoc/src/run.mjs --dry-run

systemctl start majordoc.timer
```

Le board publié garde l'ancien rendu jusqu'au prochain passage du timer. Pour le
mettre à jour tout de suite, sans attendre demain matin :

```bash
sudo -u majordoc -g majordoc node /opt/majordoc/src/run.mjs
```

Les lectrices n'ont rien à vider : l'adresse du CSS et du JS porte une empreinte
du contenu, elle change avec eux.

`config.json`, `.env` et `data/` ne sont volontairement pas écrasés. Si la nouvelle
version ajoute des réglages, comparez avec le `config.json` de l'archive :

```bash
diff /tmp/majordoc/config.json /opt/majordoc/config.json
```
