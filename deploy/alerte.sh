#!/usr/bin/env bash
# MajorDoc — notification d'échec de la génération.
#
# Appelé automatiquement par systemd (OnFailure= dans majordoc.service) quand
# la génération du matin sort en erreur. Le board affiche déjà un bandeau aux
# lectrices quand la veille date ; ce script prévient l'EXPLOITANT, qui sinon
# l'apprendrait par un message des lectrices — le trajet que l'outil existe
# pour éviter.
#
# Configuration dans /opt/majordoc/.env — l'un ou l'autre, ou les deux :
#
#   ALERTE_NTFY=https://ntfy.sh/majordoc-VOTRE-SUJET-SECRET
#       Notification push (application ntfy sur téléphone, gratuite, sans compte).
#       Choisissez un nom de sujet long et impossible à deviner : quiconque le
#       connaît peut lire les alertes.
#
#   ALERTE_MAIL=vous@exemple.fr
#       Nécessite une commande `mail` configurée sur le CT (paquet mailutils +
#       un relais SMTP). Si vous n'en avez pas déjà un, préférez ntfy.
#
# Test sans attendre une vraie panne :  systemctl start majordoc-alerte.service

set -u
RACINE="/opt/majordoc"
[ -f "$RACINE/.env" ] && set -a && . "$RACINE/.env" && set +a

SUJET="MajorDoc : la génération du $(date '+%d/%m à %H:%M') a échoué"
DETAIL="$(journalctl -u majordoc.service -n 25 --no-pager -o cat 2>/dev/null | tail -c 3500)"
[ -n "$DETAIL" ] || DETAIL="(journal indisponible — lancez : journalctl -u majordoc.service -n 50)"

envoye=0

if [ -n "${ALERTE_NTFY:-}" ]; then
  if curl -fsS -m 15 -H "Title: $SUJET" -H "Priority: high" -H "Tags: warning" \
       --data-binary "$DETAIL" "$ALERTE_NTFY" >/dev/null 2>&1; then
    envoye=1
  else
    echo "majordoc-alerte : l'envoi ntfy vers $ALERTE_NTFY a échoué." >&2
  fi
fi

if [ -n "${ALERTE_MAIL:-}" ] && command -v mail >/dev/null 2>&1; then
  if printf '%s\n' "$DETAIL" | mail -s "$SUJET" "$ALERTE_MAIL"; then
    envoye=1
  else
    echo "majordoc-alerte : l'envoi du mail à $ALERTE_MAIL a échoué." >&2
  fi
fi

if [ "$envoye" -eq 0 ]; then
  echo "majordoc-alerte : aucune alerte envoyée — renseignez ALERTE_NTFY (recommandé)" >&2
  echo "ou ALERTE_MAIL dans $RACINE/.env. La panne reste visible : journalctl -u majordoc.service" >&2
  exit 1
fi
