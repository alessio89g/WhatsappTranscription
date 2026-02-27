FROM ubuntu:22.04

USER root

# Installa Node.js, Chrome, ffmpeg, Python, supervisor e altre dipendenze
# Combina i comandi e pulisci le cache il prima possibile
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        wget \
        gnupg \
        ca-certificates \
        && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
        && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
        && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb stable main" >> /etc/apt/sources.list.d/google.list \
        && apt-get update && apt-get install -y --no-install-recommends \
        nodejs \
        google-chrome-stable \
        ffmpeg \
        python3 python3-pip \
        supervisor \
        && apt-get clean \
        && rm -rf /var/lib/apt/lists/* \
        && rm -rf /tmp/*

# Variabili ambiente per Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Imposta il fuso orario
ENV TZ=Europe/Rome
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# Copia package.json e installa le dipendenze Node.js
COPY package.json /app/
RUN npm install && npm cache clean --force

# Copia i file di configurazione e script Node.js
COPY .env /app/
COPY index.js /app/

# Setup del server Python
RUN mkdir -p /app/server
COPY server/requirements.txt /app/server/
# Installa pip con --no-cache-dir e poi rimuovi la cache di pip
RUN pip3 install --no-cache-dir -r /app/server/requirements.txt && \
    pip3 cache purge

# Copia il server Python
COPY server/app.py /app/server/

# Configura supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Aggiungi script di entrypoint
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# --- PULIZIA FINALE ---
# Queste istruzioni vengono eseguite alla fine del build
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    npm cache clean --force && \
    pip3 cache purge && \
    rm -rf /tmp/* && \
    rm -rf /root/.cache/pip

ENTRYPOINT ["/app/docker-entrypoint.sh"]