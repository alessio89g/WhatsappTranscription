FROM ubuntu:22.04

USER root

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/Rome
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV NODE_ENV=production

# ------------------------------------------------------------------
# Pacchetti di sistema
#   Rispetto alla versione precedente: NIENTE google-chrome-stable,
#   niente wget/gnupg/apt-key (servivano solo per il repo di Chrome).
#   Aggiunto git per permettere a npm di clonare dipendenze da repository.
# ------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        tzdata \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends \
        nodejs \
        ffmpeg \
        python3 \
        python3-pip \
        supervisor \
        git \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR /app

# ------------------------------------------------------------------
# Dipendenze Node (layer separato: cambia solo se cambia package.json)
# ------------------------------------------------------------------
COPY package.json /app/
RUN npm install --omit=dev && npm cache clean --force

# ------------------------------------------------------------------
# Dipendenze Python
#   Le direttive --index-url sono DENTRO requirements.txt e fanno sì
#   che torch venga preso dall'indice CPU-only di PyTorch: nessun
#   pacchetto nvidia-* / CUDA finisce nell'immagine.
# ------------------------------------------------------------------
RUN mkdir -p /app/server
COPY server/requirements.txt /app/server/
RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir -r /app/server/requirements.txt \
    && rm -rf /root/.cache/pip

# Verifica in fase di build che non sia entrato nulla di CUDA
RUN python3 -c "import torch; assert torch.version.cuda is None, 'ATTENZIONE: build CUDA di torch installata'; print('torch', torch.__version__, '(CPU-only)')"

# ------------------------------------------------------------------
# Codice applicativo
# ------------------------------------------------------------------
COPY .env /app/
COPY index.js /app/
COPY server/app.py /app/server/
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# L'entrypoint va FUORI da /app: /app viene sovrascritto dal bind mount
# del compose, e un file con CRLF (Windows) renderebbe il container non avviabile.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]