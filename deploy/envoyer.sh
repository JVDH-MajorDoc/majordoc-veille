#!/usr/bin/env bash
# MajorDoc — envoi du site vers un hébergement distant.
#
#   ./deploy/envoyer.sh ssh    utilisateur@serveur:/chemin/vers/www
#   ./deploy/envoyer.sh ftp    ftp.infomaniak.com /web    (identifiants dans .env)
#   ./deploy/envoyer.sh donnees ssh utilisateur@serveur:/chemin   (JSON seuls, quelques Ko)
#
# Le premier envoi transfère tout (≈ 430 Ko, polices comprises).
# Les suivants ne transfèrent que les JSON du jour : utilisez « donnees ».

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="$RACINE/site"
[ -d "$SITE" ] || { echo "Dossier site/ absent. Lancez d'abord : npm run digest" >&2; exit 1; }
[ -f "$RACINE/.env" ] && set -a && . "$RACINE/.env" && set +a

MODE="${1:-}"; shift || true

case "$MODE" in
  ssh)
    CIBLE="${1:?Usage : envoyer.sh ssh utilisateur@serveur:/chemin/vers/www}"
    rsync -avz --delete --chmod=D755,F644 "$SITE"/ "$CIBLE"/
    echo "Site envoyé vers $CIBLE"
    ;;
  donnees)
    [ "${1:-}" = "ssh" ] && shift
    CIBLE="${1:?Usage : envoyer.sh donnees ssh utilisateur@serveur:/chemin/vers/www}"
    rsync -avz --chmod=F644 "$SITE"/data/ "$CIBLE"/data/
    echo "Données du jour envoyées vers $CIBLE/data/"
    ;;
  ftp)
    HOTE="${1:?Usage : envoyer.sh ftp ftp.infomaniak.com /web}"
    DIST="${2:-/web}"
    : "${FTP_UTILISATEUR:?Renseignez FTP_UTILISATEUR dans .env}"
    : "${FTP_MOTDEPASSE:?Renseignez FTP_MOTDEPASSE dans .env}"
    command -v lftp >/dev/null || { echo "lftp requis : brew install lftp  /  apt install lftp" >&2; exit 1; }
    lftp -c "set ftp:ssl-force true; set ssl:verify-certificate true; \
             open -u '$FTP_UTILISATEUR','$FTP_MOTDEPASSE' '$HOTE'; \
             mirror -R --delete --parallel=4 '$SITE' '$DIST'"
    echo "Site envoyé vers $HOTE$DIST"
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
