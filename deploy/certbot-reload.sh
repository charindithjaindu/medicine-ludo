#!/bin/sh
# Installed in /etc/letsencrypt/renewal-hooks/deploy/medicine-ludo-reload.sh
case " ${RENEWED_DOMAINS:-} " in
  *" medicine-ludo.jaindu.me "*) /usr/sbin/nginx -t && /usr/bin/systemctl reload nginx ;;
esac
