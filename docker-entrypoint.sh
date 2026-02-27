#!/bin/bash
# docker-entrypoint.sh

echo "Pulizia file di lock di Chrome in /app/session_data/session/"
rm -f /app/session_data/session/Singleton*

# Disabilita core dump
ulimit -c 0

# Pulizia periodica dei file temporanei in /tmp (ogni ora)
(
    while true; do
        sleep 3600
        echo "Pulizia file temporanei in /tmp più vecchi di 1 ora..."
        find /tmp -type f -mmin +60 -delete 2>/dev/null
        echo "Pulizia completata."
    done
) &

# Pulizia della cache Hugging Face (file non acceduti da 30 giorni) - una volta al giorno
(
    while true; do
        sleep 86400
        echo "Pulizia cache Hugging Face (file non acceduti da 30 giorni)..."
        find /root/.cache/huggingface -type f -atime +30 -delete 2>/dev/null
        echo "Pulizia completata."
    done
) &

echo "Avvio supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf