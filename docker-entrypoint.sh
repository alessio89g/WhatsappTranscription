#!/bin/bash
set -e

PATH_AUDIO="${PATH_AUDIO:-/tmp}"
SESSION_PATH="${SESSION_PATH:-/app/session_data/baileys_auth}"

log() {
    echo "[$(date --iso-8601=seconds)] [ENTRYPOINT] $*"
}

log "Preparazione directory..."
mkdir -p "$PATH_AUDIO" "$SESSION_PATH" /root/.cache/huggingface

# Migrazione: la vecchia sessione whatsapp-web.js/LocalAuth è inutilizzabile
# con Baileys. Non la cancelliamo (potrebbe servirti per un rollback), la segnaliamo.
if [ -d /app/session_data/session ] && [ ! -f "$SESSION_PATH/creds.json" ]; then
    log "ATTENZIONE: trovata una vecchia sessione whatsapp-web.js in /app/session_data/session."
    log "ATTENZIONE: Baileys non puo' riutilizzarla: dovrai riscansionare il QR code."
    log "ATTENZIONE: una volta funzionante puoi cancellare quella cartella a mano."
fi

# --- Manutenzione: file temporanei in /tmp piu' vecchi di 60 minuti ---
(
    while true; do
        find "$PATH_AUDIO" -maxdepth 1 -type f -mmin +60 -delete 2>/dev/null || true
        sleep 3600
    done
) &

# --- Manutenzione: residui della cache HuggingFace, una volta al giorno ---
(
    while true; do
        sleep 86400
        find /root/.cache/huggingface -type f -name '*.lock' -atime +30 -delete 2>/dev/null || true
        find /root/.cache/huggingface -type d -name 'tmp*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
    done
) &

log "Avvio supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf