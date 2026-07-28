[ENGLISH VERSION](https://github.com/alessio89g/WhatsappTranscription/blob/main/README.md)

# WhatsApp Transcription Bot

Bot per WhatsApp che trascrive automaticamente i messaggi vocali ricevuti. Il sistema funziona tramite container Docker, si collega a WhatsApp usando il protocollo nativo Multi-Device (nessun browser coinvolto) e utilizza i server Google per la trascrizione vocale.

L'idea del progetto è nata sulle basi di questo repository: <br>
https://github.com/puluceno/WhatsappTranscriptionOffline <br>
La quasi totalità del codice è stata generata da AI (DeepSeek e Claude); io ho per lo più fatto da tester per il debugging ed orchestrato il lavoro.

---

## Panoramica

Questo progetto implementa un bot WhatsApp che ascolta i messaggi vocali in arrivo, li converte in formato audio appropriato e li trascrive utilizzando servizi di riconoscimento vocale. La trascrizione viene poi inviata come risposta al messaggio originale.

---

## Architettura del Sistema

### Sistema Operativo

- **Ubuntu 22.04 LTS (Jammy Jellyfish)** - Distribuzione Linux stabile e supportata a lungo termine

### Componenti Principali

Il container include tre componenti principali che cooperano tra loro:

**1. Client WhatsApp (Node.js)**

- File: `index.js`
- Libreria: `@whiskeysockets/baileys`
- Funzione: si collega direttamente al protocollo WebSocket nativo Multi-Device di WhatsApp, riceve i messaggi e gestisce il QR code. Nessun browser o automazione del DOM: la libreria parla il protocollo direttamente.

**2. Server di Trascrizione (Python)**

- File: `server/app.py`
- Framework: FastAPI con Uvicorn
- Funzione: Riceve file audio, invia ai server Google per la trascrizione, aggiunge punteggiatura

**3. Gestore Processi (Supervisord)**

- File: `supervisord.conf`
- Funzione: Avvia e monitora i processi Node.js e Python, li riavvia in caso di crash

---

## Tecnologie Utilizzate

### Runtime e Linguaggi

- Node.js 20.x LTS
- Python 3.10

### Librerie Node.js

- `@whiskeysockets/baileys` - Client WhatsApp Multi-Device nativo (WebSocket)
- `pino` - Logger richiesto da Baileys
- `qrcode-terminal` - Visualizzazione QR code nel terminale
- `axios` - Client HTTP per comunicazione interna
- `form-data` - Gestione upload file
- `dotenv` - Gestione variabili d'ambiente

### Librerie Python

- `fastapi` - Framework web asincrono
- `uvicorn` - Server ASGI
- `python-multipart` - Gestione upload multipart
- `SpeechRecognition` - Invio audio ai server Google per trascrizione
- `deepmultilingualpunctuation` - Aggiunta punteggiatura automatica (in locale)
- `transformers` - Modelli NLP per punteggiatura
- `torch` - Backend ML (build CPU-only)
- `numpy` - Calcolo numerico, dipendenza dello stack ML

### Strumenti di Sistema

- `ffmpeg` - Conversione formati audio
- `ffprobe` - Analisi metadati audio
- `git` - Necessario a npm per scaricare alcune dipendenze direttamente da repository
- `supervisor` - Gestione processi

---

## Struttura del Progetto

```
WhatsappTranscription/
├── docker-compose.yml          # Configurazione Docker Compose (usa env_file, bind mount del codice sorgente)
├── Dockerfile                  # Definizione del container
├── docker-entrypoint.sh        # Script di avvio
├── supervisord.conf            # Configurazione Supervisor (esegue Node e Python)
├── .env                        # Variabili d'ambiente (caricate tramite env_file)
├── .dockerignore               # Esclusioni per la build Docker
├── .gitignore                  # Esclusioni Git
├── .gitattributes              # Forza il line-ending LF sui file eseguiti nel container
├── package.json                # Dipendenze Node.js
├── index.js                    # Bot WhatsApp con supporto per esclusione gruppi
├── README.md                   # README_it.md tradotto in Inglese
├── README_it.md                # Questo file
├── server/
│   ├── app.py                  # Server FastAPI per la trascrizione
│   └── requirements.txt        # Dipendenze Python
└── Volumes/                    # Dati persistenti (sessione, modelli, cache)
    ├── session_data/           # Sessione Baileys (credenziali Multi-Device, in baileys_auth/)
    └── cache/                  # Cache modelli Hugging Face (modello di punteggiatura, ~2 GB)
```

> **Note:**  
Tutte le cartelle sotto `Volumes/` sono montate come volumi Docker in percorsi specifici all'interno del container. In questo modo i dati critici (sessione, modelli, cache) risiedono direttamente sul filesystem Windows, evitando una crescita incontrollata del file VHDX di WSL2.  
L'intera directory del progetto (esclusa `node_modules`) è montata in bind mount su `/app` all'interno del container. Questo permette di modificare i file sorgente (`.env`, `index.js`, `server/app.py`, ecc.) e applicare le modifiche semplicemente riavviando il container con `docker-compose restart`. Non è necessaria una ricostruzione a meno che non vengano modificati `package.json` o `requirements.txt`.  
I file audio temporanei vivono in `/tmp`, montato come `tmpfs`: restano quindi in RAM e non toccano mai il disco.

---

## GUIDA RAPIDA

Installare Docker in modalità WSL2

Scaricare dalla sezione Releases il file

Source code.zip

Estrarre il contenuto del file compresso nel suo percorso definitivo

Assegnare alla cartella contenente i file del progetto il nome

WhatsappTranscription

Avviare il Terminale nella cartella del progetto ed eseguire i comandi di build ed avvio del container

```bash
docker-compose down

docker-compose up -d --build
```

Aprire il log del container con il comando

```bash
docker logs -f whatsapptranscription_container
```

Aprire adesso

WhatsApp

sullo smartphone, toccare l'icona dell'

Overflow menu

selezionare

Dispositivi collegati

e poi

Collega un dispositivo

Inquadrare quindi il QRcode nel log visibile nella finestra del Terminale.

Attendere l'output

`WhatsApp client is ready!`

Al completamento dell'operazione, sarà possibile chiudere il Terminale.

> Il container è configurato con `restart: always`, quindi si riavvia automaticamente insieme a Docker Desktop, anche dopo che è stato chiuso manualmente dalla TrayBar.

---

## Configurazione

### Variabili d'Ambiente

Il file `.env` espone le seguenti variabili:

| Variabile | Default | Descrizione |
|---|---|---|
| `PATH_AUDIO` | `/tmp` | Cartella per i file audio temporanei (montata come `tmpfs`, quindi in RAM) |
| `SESSION_PATH` | `/app/session_data/baileys_auth` | Cartella dove Baileys salva le credenziali della sessione Multi-Device |
| `TRANSCRIBE_URL` | `http://127.0.0.1:8000/transcribe` | Endpoint interno del server Python di trascrizione |
| `TRANSCRIBE_TIMEOUT_MS` | `180000` | Timeout della richiesta HTTP verso il server di trascrizione |
| `GROUPS` | `*` | `*` = tutti i gruppi abilitati alla trascrizione; altrimenti elenco di ID separati da virgola |
| `EXCLUDED_GROUPS` | *(vuoto)* | ID dei gruppi da escludere dalla trascrizione, separati da virgola |
| `SHOW_CHAT_IDS` | `false` | `true` per vedere gli ID reali delle chat nei log (serve per popolare `EXCLUDED_GROUPS`) |
| `TRANSCRIBE_OWN_MESSAGES` | `true` | Trascrive anche i vocali inviati dal numero collegato al bot |
| `ONLY_PTT` | `false` | `true` = trascrive solo le note vocali; `false` = anche i file audio allegati |
| `MAX_AUDIO_SECONDS` | `0` | Ignora gli audio più lunghi di N secondi (`0` = nessun limite) |
| `MARK_AS_READ` | `false` | Segna come letti i messaggi vocali dopo la trascrizione |
| `BAILEYS_LOG_LEVEL` | `silent` | Verbosità del logger interno di Baileys (`silent`, `error`, `warn`, `info`, `debug`, `trace`) |
| `TZ` | `Europe/Rome` | Fuso orario del container |

### Escludere un gruppo dalla trascrizione

1. **Abilita temporaneamente la visualizzazione degli ID**  
   Modifica il file `.env` e imposta `SHOW_CHAT_IDS=true`.  
   Poi riavvia il container:  
   ```bash
   docker-compose restart
   ```

2. **Trova l'ID del gruppo**  
   Invia un qualsiasi messaggio vocale nel gruppo che vuoi escludere.  
   Nei log del container (`docker-compose logs -f`) vedrai una riga simile a:  
   ```
   2026-07-27T12:34:56+02:00|group| (audio ricevuto) - Chat ID: 393345872509-1442996558@g.us - ptt=true - durata dichiarata=7s
   ```  
   La parte `393345872509-1442996558@g.us` (o che termina con `@lid`) è l'ID del gruppo. Copiala esattamente così com'è: è il JID assegnato dai server WhatsApp e non cambia mai nel corso della vita del gruppo, indipendentemente da nome, admin o partecipanti.

3. **Imposta l'esclusione**  
   Apri nuovamente `.env` e aggiungi l'ID a `EXCLUDED_GROUPS`. Ad esempio:  
   ```
   EXCLUDED_GROUPS=393345872509-1442996558@g.us
   ```
   Per escludere più gruppi, separali con virgole:  
   ```
   EXCLUDED_GROUPS=id1@g.us,id2@g.us
   ```

4. **Riavvia il container**  
   Dopo aver modificato `.env`, riavvia il container:  
   ```bash
   docker-compose restart
   ```

5. **(Opzionale) Nascondi nuovamente gli ID**  
   Se preferisci non mostrare gli ID reali nei log, imposta `SHOW_CHAT_IDS=false` in `.env` e riavvia il container un'ultima volta.

---

## Funzionamento

### Flusso di Elaborazione

1. **Ricezione**: Il bot riceve l'evento del messaggio su WhatsApp
2. **Filtro**: Controlla, prima di scaricare qualunque dato, se il messaggio è un vocale/audio e se la chat è abilitata alla trascrizione
3. **Download**: Se il messaggio supera il filtro, scarica il buffer audio direttamente dai server WhatsApp (nessun browser coinvolto)
4. **Conversione**: Converte in WAV 16kHz mono con ffmpeg
5. **Invio a Google**: Il server Python invia il file audio ai server Google Speech Recognition
6. **Ricezione trascrizione**: Riceve il testo trascritto dai server Google
7. **Punteggiatura**: Aggiunge punteggiatura con modello NLP (in locale)
8. **Risposta**: Invia la trascrizione come risposta citata al messaggio originale
9. **Pulizia**: Cancella i file temporanei (che comunque vivono solo in RAM, essendo `/tmp` un `tmpfs`)

### Privacy e Sicurezza

**Attenzione**: I file audio vengono inviati ai server Google per la trascrizione.

- Nessun salvataggio permanente dei file audio sul container: vivono solo in RAM (`/tmp` come `tmpfs`) e vengono cancellati dopo l'elaborazione
- Nessuna registrazione delle trascrizioni nei log
- I log contengono solo informazioni tecniche (durata, tempi, ID chat se `SHOW_CHAT_IDS=true`)
- La sessione WhatsApp (credenziali Multi-Device) viene salvata localmente nella cartella `Volumes/session_data/baileys_auth/`
- Il client si collega direttamente al protocollo WhatsApp e non passa mai per un browser o per WhatsApp Web

> **Nota**: Baileys non è una libreria ufficiale di WhatsApp/Meta, ma un'implementazione del protocollo Multi-Device ottenuta tramite reverse engineering. È più stabile della vecchia automazione basata su browser, ma resta un client non autorizzato: usalo con un numero di cui non ti dispiacerebbe perdere l'accesso ed evita invii massivi.

---

## Ottimizzazioni e Manutenzione

### Controllo della Crescita del Disco

Per evitare che il file VHDX di WSL2 cresca indefinitamente, sono state adottate le seguenti misure:

- Volumi su Windows: le directory che accumulano dati (`session_data`, cache modelli) sono montate su cartelle Windows tramite `./Volumes/`.
- Ogni ora vengono eliminati i file in `/tmp` più vecchi di 60 minuti.
- Ogni 24 ore vengono rimossi i file temporanei di Hugging Face non acceduti da 30 giorni (es. file `.lock`), preservando i modelli principali.
- Rotazione dei log Docker: nel `docker-compose.yml` è configurato un limite di 3 file di log da 100 MB ciascuno.
- Limitazione della dimensione del VHDX: creare (o modificare) il file `%UserProfile%\.wslconfig` con il seguente contenuto in cima:

```
[wsl2]
defaultVhdSize=20GB
```

### Shrink file VHDX

Dopo aver avviato e configurato il container, sarà possibile recuperare dello spazio su disco, compattando il file VHDX della distro Docker eseguendo questi comandi

```bash
docker system prune -a -f --volumes

docker builder prune -a -f
```

Chiudere Docker dalla TrayBar

```bash
wsl --shutdown

diskpart

select vdisk file="%LocalAppData%\Docker\wsl\disk\docker_data.vhdx"

attach vdisk readonly

compact vdisk

detach vdisk

exit
```

---

## Licenza

Questo progetto è fornito così com'è, senza garanzie di alcun tipo.

---

## Crediti

- `@whiskeysockets/baileys` - https://github.com/WhiskeySockets/Baileys
- Google Speech Recognition
- DeepMultilingualPunctuation
- Idea Originale - https://github.com/puluceno/WhatsappTranscriptionOffline
