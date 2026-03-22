# WhatsApp Transcription Bot

Bot per WhatsApp che trascrive automaticamente i messaggi vocali ricevuti. Il sistema funziona tramite container Docker e utilizza i server Google per la trascrizione vocale.

L'idea del progetto è nata sulle basi di questo repository: <br>
https://github.com/puluceno/WhatsappTranscriptionOffline <br>
La quasi totalità del codice è stata generata da DeepSeek; io ho per lo più fatto da tester per il debugging ed orchestrato il suo lavoro.



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
- Libreria: `whatsapp-web.js` con Puppeteer
- Funzione: Interfaccia con WhatsApp Web, ricezione messaggi, gestione QR code

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

- Node.js 18.x
- Python 3.10

### Librerie Node.js

- `whatsapp-web.js` - Client WhatsApp Web
- `puppeteer` - Controllo browser Chrome headless
- `qrcode-terminal` - Visualizzazione QR code nel terminale
- `axios` - Client HTTP per comunicazione interna
- `form-data` - Gestione upload file
- `mime-types` - Rilevamento tipi MIME
- `dotenv` - Gestione variabili d'ambiente

### Librerie Python

- `fastapi` - Framework web asincrono
- `uvicorn` - Server ASGI
- `SpeechRecognition` - Invio audio ai server Google per trascrizione
- `deepmultilingualpunctuation` - Aggiunta punteggiatura automatica (in locale)
- `transformers` - Modelli NLP per punteggiatura
- `torch` - Backend ML

### Strumenti di Sistema

- `ffmpeg` - Conversione formati audio
- `ffprobe` - Analisi metadati audio
- `google-chrome-stable` - Browser per Puppeteer
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
├── package.json                # Dipendenze Node.js
├── index.js                    # Bot WhatsApp con supporto per esclusione gruppi
├── README.md                   # README_it.md tradotto in Inglese
├── README_it.md                # Questo file
├── server/
│   ├── app.py                  # Server FastAPI per la trascrizione
│   └── requirements.txt        # Dipendenze Python
└── Volumes/                    # Dati persistenti (sessione, modelli, cache)
    ├── session_data/           # Sessione WhatsApp
    ├── cache/                  # Modelli Hugging Face
    ├── root_config/            # Configurazione/cache di Chrome
    ├── var_cache/              # Cache di sistema
    ├── var_log/                # Log di sistema
    └── var_tmp/                # File temporanei persistenti

```

> **Note:**  
Tutte le cartelle sotto `Volumes/` sono montate come volumi Docker in percorsi specifici all'interno del container. In questo modo i dati critici (sessione, modelli, cache) risiedono direttamente sul filesystem Windows, evitando una crescita incontrollata del file VHDX di WSL2.  
L'intera directory del progetto (esclusa `node_modules`) è montata in bind mount su `/app` all'interno del container. Questo permette di modificare i file sorgente (`.env`, `index.js`, `server/app.py`, ecc.) e applicare le modifiche semplicemente riavviando il container con `docker-compose restart`. Non è necessaria una ricostruzione a meno che non vengano modificati `package.json` o `requirements.txt`.

---
			   
## GUIDA RAPIDA

Installare Docker in modalità WSL2

 

 Scaricare dalla sezione Releases il file

Source code.zip

 Estrarre il contenuto del file compresso nel suo percorso definitivo

 Assegnare alla cartella contenente i file del progetto il nome

WhatsappTranscription



 Avviare il Terminale nella cartella del progetto ed eseguire i comandi di build ed avvio del container

docker-compose down

docker-compose up -d --build



 Aprire il log del container con il comando

docker logs -f whatsapptranscription_container

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

WhatsApp client is ready!

 Al completamento dell'operazione, sarà possibile chiudere il Terminale.



---

## Configurazione



### Variabili d'Ambiente

Per impedire al bot di trascrivere le note vocali in un gruppo WhatsApp specifico:

1. **Abilita temporaneamente la visualizzazione degli ID**  
   Modifica il file `.env` e imposta `SHOW_CHAT_IDS=true`.  
   Poi riavvia il container:  
   ```bash
   docker-compose restart
   ```

2. **Trova l'ID del gruppo**  
   Invia un qualsiasi messaggio (anche di testo) nel gruppo che vuoi escludere.  
   Nei log del container (`docker-compose logs -f`) vedrai una riga simile a:  
   ```
   [DEBUG] Messaggio da chat: 1234567890-123456@g.us (isGroup=true) - Tipo: chat
   ```  
   La parte `1234567890-123456@g.us` (o che termina con `@lid`) è l'ID del gruppo.

3. **Imposta l'esclusione**  
   Apri nuovamente `.env` e aggiungi l'ID a `EXCLUDED_GROUPS`. Ad esempio:  
   ```
   EXCLUDED_GROUPS=1234567890-123456@g.us
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

1. **Ricezione**: Il bot riceve un messaggio vocale su WhatsApp
2. **Download**: Scarica il file audio in formato OGG/Opus
3. **Conversione**: Converte in WAV 16kHz mono con ffmpeg
4. **Invio a Google**: Il server Python invia il file audio ai server Google Speech Recognition
5. **Ricezione trascrizione**: Riceve il testo trascritto dai server Google
6. **Punteggiatura**: Aggiunge punteggiatura con modello NLP (in locale)
7. **Risposta**: Invia la trascrizione come risposta al messaggio
8. **Pulizia**: Cancella i file temporanei

### Privacy e Sicurezza

**Attenzione**: I file audio vengono inviati ai server Google per la trascrizione.

- Nessun salvataggio permanente dei file audio sul container
- Nessuna registrazione delle trascrizioni nei log
- I log contengono solo informazioni tecniche (durata, tempi)
- I file audio temporanei vengono cancellati dopo l'elaborazione
- La sessione WhatsApp viene salvata localmente nella cartella Volumes/session_data/


---

## Ottimizzazioni e Manutenzione



### Controllo della Crescita del Disco

 Per evitare che il file VHDX di WSL2 cresca indefinitamente, sono state adottate le seguenti misure:

- Volumi su Windows: Tutte le directory che accumulano dati (session_data, cache modelli, log, ecc.) sono montate su cartelle Windows tramite ./Volumes/.
- Ogni ora vengono eliminati i file in /tmp più vecchi di 60 minuti.
- Ogni 24 ore vengono rimossi i file temporanei di Hugging Face non acceduti da 30 giorni (es. file .lock), preservando i modelli principali.
- Rotazione dei log Docker: Nel docker-compose.yml è configurato un limite di 3 file di log da 100 MB ciascuno.
- Limitazione della dimensione del VHDX: Creare (o modificare) il file `%UserProfile%\.wslconfig` con il seguente contenuto in cima:

```
[wsl2]
defaultVhdSize=20GB
```



### Shrink file VHDX

 Dopo aver avviato e configurato il container, sarà possibile recuperare dello spazio su disco, compattando il file VHDX della distro Docker eseguendo questi comandi

docker system prune -a -f --volumes

docker builder prune -a -f

 Chiudere Docker dalla TrayBar

wsl --shutdown

diskpart

select vdisk file="%LocalAppData%\Docker\wsl\disk\docker_data.vhdx"

attach vdisk readonly

compact vdisk

detach vdisk

exit

---


## Licenza

Questo progetto e fornito cosi come e, senza garanzie di alcun tipo.


---

## Crediti

- `whatsapp-web.js` - https://github.com/pedroslopez/whatsapp-web.js
- Google Speech Recognition
- DeepMultilingualPunctuation
- Idea Originale - https://github.com/puluceno/WhatsappTranscriptionOffline
