'use strict';

const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const { execFile } = require('child_process');

const axios = require('axios');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
require('dotenv').config();

const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const execFileAsync = util.promisify(execFile);

process.env.TZ = process.env.TZ || 'Europe/Rome';

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

function logWithTimestamp(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

// Logger interno di Baileys: silenzioso per default, alzalo con BAILEYS_LOG_LEVEL=debug
const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

/* ------------------------------------------------------------------ */
/* Configurazione                                                      */
/* ------------------------------------------------------------------ */

const PATH_AUDIO       = process.env.PATH_AUDIO || '/tmp';
const SESSION_PATH     = process.env.SESSION_PATH || '/app/session_data/baileys_auth';
const TRANSCRIBE_URL   = process.env.TRANSCRIBE_URL || 'http://127.0.0.1:8000/transcribe';
const SHOW_CHAT_IDS    = process.env.SHOW_CHAT_IDS === 'true';
const TRANSCRIBE_OWN   = process.env.TRANSCRIBE_OWN_MESSAGES !== 'false'; // default: sì
const ONLY_PTT         = process.env.ONLY_PTT === 'true';                 // default: anche file audio
const MARK_AS_READ     = process.env.MARK_AS_READ === 'true';
const MAX_AUDIO_SEC    = parseInt(process.env.MAX_AUDIO_SECONDS || '600', 10);
const HTTP_TIMEOUT_MS  = parseInt(process.env.TRANSCRIBE_TIMEOUT_MS || '180000', 10);

const allowedGroups = (process.env.GROUPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const excludedList = (process.env.EXCLUDED_GROUPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

logWithTimestamp('[INIT] PATH_AUDIO      =', PATH_AUDIO);
logWithTimestamp('[INIT] SESSION_PATH    =', SESSION_PATH);
logWithTimestamp('[INIT] TRANSCRIBE_URL  =', TRANSCRIBE_URL);
logWithTimestamp('[INIT] GROUPS          =', process.env.GROUPS);
logWithTimestamp('[INIT] EXCLUDED_GROUPS =', process.env.EXCLUDED_GROUPS);
logWithTimestamp('[INIT] SHOW_CHAT_IDS   =', SHOW_CHAT_IDS);
logWithTimestamp('[INIT] ONLY_PTT        =', ONLY_PTT);
logWithTimestamp('[INIT] TZ              =', process.env.TZ);

/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */

function getSafeChatId(jid, isGroup) {
    if (!isGroup) return 'user';
    if (SHOW_CHAT_IDS) return jid;
    return jid.replace(/[0-9]+/g, 'xxx');
}

const EXT_BY_MIME = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
};

function extFromMime(mimetype) {
    if (!mimetype) return 'ogg';
    const base = String(mimetype).split(';')[0].trim().toLowerCase();
    return EXT_BY_MIME[base] || 'ogg';
}

// Coda sequenziale: il modello di punteggiatura è pesante, un audio alla volta.
let chain = Promise.resolve();
function enqueue(task) {
    const result = chain.then(() => task());
    chain = result.catch(() => {});
    return result;
}

async function safeUnlink(file) {
    if (!file) return;
    try {
        await fs.unlink(file);
    } catch (_) { /* già rimosso */ }
}

async function getAudioDuration(filePath) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath,
        ]);
        const value = parseFloat(stdout);
        return Number.isFinite(value) ? value : null;
    } catch (error) {
        logWithTimestamp(`[WARN] ffprobe fallito su ${filePath}: ${error.message}`);
        return null;
    }
}

async function convertToWav(input, output) {
    // execFile con array di argomenti: nessun problema con spazi o caratteri speciali
    await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-vn',
        '-ar', '16000',
        '-ac', '1',
        output,
    ]);
}

async function transcribe(wavPath) {
    const form = new FormData();
    form.append('file', await fs.readFile(wavPath), {
        filename: 'audio.wav',
        contentType: 'audio/wav',
    });

    const response = await axios.post(TRANSCRIBE_URL, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: HTTP_TIMEOUT_MS,
    });

    return response.data && typeof response.data.text === 'string'
        ? response.data.text.trim()
        : '';
}

/* ------------------------------------------------------------------ */
/* Estrazione del contenuto reale del messaggio                        */
/* ------------------------------------------------------------------ */

// I vocali possono arrivare incapsulati (messaggi effimeri, view-once, ecc.):
// scartiamo i wrapper fino a trovare il contenuto vero.
function unwrapMessage(message) {
    let content = message;
    for (let i = 0; i < 6 && content; i++) {
        if (content.ephemeralMessage)            { content = content.ephemeralMessage.message; continue; }
        if (content.viewOnceMessage)             { content = content.viewOnceMessage.message; continue; }
        if (content.viewOnceMessageV2)           { content = content.viewOnceMessageV2.message; continue; }
        if (content.viewOnceMessageV2Extension)  { content = content.viewOnceMessageV2Extension.message; continue; }
        if (content.documentWithCaptionMessage)  { content = content.documentWithCaptionMessage.message; continue; }
        break;
    }
    return content || null;
}

function shouldTranscribeChat(jid, isGroup) {
    if (!isGroup) return true;
    if (excludedList.includes(jid)) return false;
    if (allowedGroups.includes('*')) return true;
    return allowedGroups.includes(jid);
}

/* ------------------------------------------------------------------ */
/* Elaborazione di un singolo vocale                                   */
/* ------------------------------------------------------------------ */

async function processAudioMessage(sock, msg, content, audioMessage) {
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const safeChatId = getSafeChatId(jid, isGroup);
    const chatType = isGroup ? 'group' : 'user';

    const declaredSeconds = audioMessage.seconds || 0;
    logWithTimestamp(
        `${new Date().toISOString()}|${chatType}| (audio ricevuto) - Chat ID: ${safeChatId} ` +
        `- ptt=${!!audioMessage.ptt} - durata dichiarata=${declaredSeconds}s`
    );

    if (MAX_AUDIO_SEC > 0 && declaredSeconds > MAX_AUDIO_SEC) {
        logWithTimestamp(`[INFO] Audio troppo lungo (${declaredSeconds}s > ${MAX_AUDIO_SEC}s), salto`);
        return;
    }

    const id = crypto.randomUUID();
    const rawFile = path.join(PATH_AUDIO, `${id}.${extFromMime(audioMessage.mimetype)}`);
    const wavFile = path.join(PATH_AUDIO, `${id}.wav`);

    try {
        // --- Download: nessun browser, decrittazione fatta da Baileys in memoria ---
        logWithTimestamp('[DEBUG] Download media...');
        const startDownload = Date.now();

        const buffer = await downloadMediaMessage(
            { key: msg.key, message: content },
            'buffer',
            {},
            {
                logger: baileysLogger,
                // se il media è scaduto sui server WA, Baileys chiede al mittente di re-inviarlo
                reuploadRequest: sock.updateMediaMessage,
            }
        );

        if (!buffer || !buffer.length) {
            logWithTimestamp('[ERRORE] Buffer audio vuoto, salto');
            return;
        }
        logWithTimestamp(
            `[DEBUG] Download completato: ${buffer.length} byte in ` +
            `${((Date.now() - startDownload) / 1000).toFixed(2)}s`
        );

        await fs.writeFile(rawFile, buffer);

        // --- Conversione ---
        await convertToWav(rawFile, wavFile);
        const wavDuration = await getAudioDuration(wavFile);
        logWithTimestamp(
            `[INFO] Convertito in wav 16kHz mono` +
            (wavDuration !== null ? ` (${wavDuration.toFixed(2)}s)` : '')
        );

        // --- Trascrizione ---
        const startTime = Date.now();
        const transcription = await transcribe(wavFile);
        const elapsed = (Date.now() - startTime) / 1000;
        const audioDuration = wavDuration || declaredSeconds || 0;

        logWithTimestamp(
            `[INFO] Tempo di elaborazione: ${elapsed.toFixed(2)} secondi ` +
            `per un audio di ${audioDuration.toFixed(2)} secondi`
        );

        if (!transcription) {
            logWithTimestamp('[INFO] Trascrizione vuota, nessuna risposta inviata');
            return;
        }

        await sock.sendMessage(
            jid,
            { text: `🗣️ *Trascrizione Automatica Nota Vocale:*\n\n${transcription}` },
            { quoted: msg }
        );
        logWithTimestamp('[DEBUG] Risposta inviata con successo');

    } catch (error) {
        logWithTimestamp(`[ERRORE] Elaborazione audio fallita: ${error.message}`);
        if (error.response) {
            logWithTimestamp(
                `[ERRORE] Risposta server: ${error.response.status} - ` +
                `${JSON.stringify(error.response.data)}`
            );
        }
        if (error.code === 'ECONNREFUSED') {
            logWithTimestamp(`[ERRORE] Connessione rifiutata: il server Python non risponde su ${TRANSCRIBE_URL}`);
        }
        if (error.stack) logWithTimestamp(error.stack);
    } finally {
        await safeUnlink(rawFile);
        await safeUnlink(wavFile);
    }
}

/* ------------------------------------------------------------------ */
/* Handler messaggi                                                    */
/* ------------------------------------------------------------------ */

async function handleMessage(sock, msg) {
    const jid = msg.key && msg.key.remoteJid;
    if (!jid || !msg.message) return;

    // Scarta stati, liste broadcast e canali
    if (jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;

    const content = unwrapMessage(msg.message);
    const audioMessage = content && content.audioMessage;
    if (!audioMessage) return;                            // filtro PRIMA di scaricare qualsiasi cosa

    if (ONLY_PTT && !audioMessage.ptt) {
        logWithTimestamp('[DEBUG] Audio non-ptt e ONLY_PTT=true, salto');
        return;
    }

    if (msg.key.fromMe && !TRANSCRIBE_OWN) {
        logWithTimestamp('[DEBUG] Messaggio inviato da me e TRANSCRIBE_OWN_MESSAGES=false, salto');
        return;
    }

    const isGroup = jid.endsWith('@g.us');
    if (!shouldTranscribeChat(jid, isGroup)) {
        logWithTimestamp(`[DEBUG] Chat non abilitata alla trascrizione: ${getSafeChatId(jid, isGroup)}`);
        return;
    }

    if (MARK_AS_READ) {
        try { await sock.readMessages([msg.key]); } catch (_) {}
    }

    // Un audio alla volta
    await enqueue(() => processAudioMessage(sock, msg, content, audioMessage));
}

/* ------------------------------------------------------------------ */
/* Socket + riconnessione                                              */
/* ------------------------------------------------------------------ */

// Piccola cache dei messaggi recenti: serve a Baileys per rispedire/ridecifrare
// un messaggio quando riceve una retry-receipt.
const recentMessages = new Map();
const RECENT_MAX = 300;

function rememberMessage(msg) {
    if (!msg.key || !msg.key.id) return;
    recentMessages.set(msg.key.id, msg.message);
    if (recentMessages.size > RECENT_MAX) {
        recentMessages.delete(recentMessages.keys().next().value);
    }
}

let reconnectAttempts = 0;
let shuttingDown = false;
let currentSock = null;

async function startSock() {
    await fs.mkdir(SESSION_PATH, { recursive: true });
    await fs.mkdir(PATH_AUDIO, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    let version;
    try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
        logWithTimestamp(`[INIT] Versione protocollo WhatsApp: ${version.join('.')}`);
    } catch (error) {
        logWithTimestamp(`[WARN] fetchLatestBaileysVersion fallita (${error.message}), uso il default della libreria`);
    }

    const sock = makeWASocket({
        version,
        logger: baileysLogger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        browser: Browsers.ubuntu('Chrome'),   // solo un'etichetta mostrata in "Dispositivi collegati"
        printQRInTerminal: false,             // il QR lo stampiamo noi (l'opzione è deprecata)
        syncFullHistory: false,               // non scaricare lo storico: risparmia RAM e tempo
        markOnlineOnConnect: false,           // così le notifiche continuano ad arrivare sul telefono
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => recentMessages.get(key.id),
    });

    currentSock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logWithTimestamp('Scan this QR code with your phone:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            reconnectAttempts = 0;
            logWithTimestamp('WhatsApp client is ready!');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect && lastDisconnect.error
                && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;

            if (shuttingDown) {
                logWithTimestamp('[INFO] Connessione chiusa durante lo shutdown');
                return;
            }

            if (statusCode === DisconnectReason.loggedOut) {
                logWithTimestamp('[FATAL] Sessione terminata dal telefono (logged out).');
                logWithTimestamp(`[FATAL] Cancella il contenuto di ${SESSION_PATH} e riavvia per riscansionare il QR.`);
                return; // niente reconnect loop: servirebbe comunque un nuovo QR
            }

            reconnectAttempts += 1;
            const delay = Math.min(30000, 2000 * reconnectAttempts);
            logWithTimestamp(
                `[WARN] Connessione chiusa (status=${statusCode}). ` +
                `Riconnessione #${reconnectAttempts} tra ${delay}ms`
            );
            setTimeout(() => {
                startSock().catch(err => logWithTimestamp(`[FATAL] Riconnessione fallita: ${err.message}`));
            }, delay);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // 'notify' = messaggi nuovi in tempo reale. 'append' = sincronizzazioni, da ignorare.
        if (type !== 'notify') return;

        for (const msg of messages) {
            rememberMessage(msg);
            try {
                await handleMessage(sock, msg);
            } catch (error) {
                logWithTimestamp(`[ERRORE] Generale: ${error.message}`);
                if (error.stack) logWithTimestamp(error.stack);
            }
        }
    });

    return sock;
}

/* ------------------------------------------------------------------ */
/* Avvio e spegnimento pulito                                          */
/* ------------------------------------------------------------------ */

process.on('unhandledRejection', (reason) => {
    logWithTimestamp('[FATAL] Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (error) => {
    logWithTimestamp('[FATAL] Uncaught Exception:', error && error.stack ? error.stack : error);
});

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logWithTimestamp(`[INFO] Ricevuto ${signal}, chiusura in corso...`);
    try {
        if (currentSock) currentSock.end(undefined);
    } catch (_) {}
    setTimeout(() => process.exit(0), 1500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startSock().catch((error) => {
    logWithTimestamp(`[FATAL] Avvio fallito: ${error.message}`);
    if (error.stack) logWithTimestamp(error.stack);
    process.exit(1);
});