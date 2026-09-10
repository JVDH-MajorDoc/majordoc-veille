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
nano /etc/nginx/sites-available/majordoc
```

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
"tarif": { "entree_usd_mtok": 3, "sortie_usd_mtok": 15, "eur_usd": 0.86 }
```

Ce sont les prix de Sonnet 4.5 par million de tokens et un taux de change. À
revoir si vous changez de modèle ou si les prix bougent ; supprimer le bloc
revient à l'affichage en tokens seuls. L'ordre de grandeur d'une journée à
quinze fiches est de quelques dizaines de centimes.

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

## 15. Mettre à jour MajorDoc

Quand une nouvelle version de l'archive arrive :

```bash
systemctl stop majordoc.timer
cd /tmp && rm -rf majordoc && unzip -q majordoc-nouvelle-version.zip

# on préserve la configuration et l'historique
cp -r majordoc/src /opt/majordoc/
cp majordoc/package.json majordoc/README.md majordoc/DEPLOIEMENT.md majordoc/INSTALLATION.md /opt/majordoc/
cp -r majordoc/deploy /opt/majordoc/

chown -R majordoc:majordoc /opt/majordoc
sudo -u majordoc -g majordoc node /opt/majordoc/src/run.mjs --dry-run   # contrôle
systemctl start majordoc.timer
```

`config.json`, `.env` et `data/` ne sont volontairement pas écrasés. Si la nouvelle
version ajoute des réglages, comparez avec le `config.json` de l'archive :

```bash
diff /tmp/majordoc/config.json /opt/majordoc/config.json
```
