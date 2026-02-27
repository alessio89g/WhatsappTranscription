import os
import logging
import speech_recognition as sr
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from deepmultilingualpunctuation import PunctuationModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Carica il modello di punteggiatura una sola volta all'avvio
logger.info("Caricamento del modello di punteggiatura...")
try:
    punct_model = PunctuationModel(model="oliverguhr/fullstop-punctuation-multilang-large")
    logger.info("Modello di punteggiatura caricato con successo.")
except Exception as e:
    logger.error(f"Errore nel caricare il modello di punteggiatura: {e}")
    raise e

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    temp_filename = f"/tmp/{file.filename}"
    try:
        contents = await file.read()
        with open(temp_filename, "wb") as f:
            f.write(contents)

        # Riconoscimento vocale gratuito via Google
        r = sr.Recognizer()
        with sr.AudioFile(temp_filename) as source:
            audio_data = r.record(source)

        testo_grezzo = r.recognize_google(audio_data, language="it-IT")
        logger.info(f"Trascrizione grezza ottenuta ({len(testo_grezzo)} caratteri)")

        # Aggiunta della punteggiatura
        testo_con_punteggiatura = punct_model.restore_punctuation(testo_grezzo)
        logger.info("Punteggiatura applicata")

        return JSONResponse({"text": testo_con_punteggiatura})

    except sr.UnknownValueError:
        logger.warning("Google Speech Recognition non ha capito l'audio")
        return JSONResponse({"text": "[Audio non comprensibile]"})
    except sr.RequestError as e:
        logger.error(f"Errore di connessione a Google: {e}")
        raise HTTPException(status_code=503, detail="Servizio di riconoscimento vocale non disponibile")
    except Exception as e:
        logger.exception("Errore durante la trascrizione")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_filename):
            os.remove(temp_filename)