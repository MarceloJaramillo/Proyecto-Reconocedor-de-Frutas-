import base64
import io
import json
import os
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import tensorflow as tf

APP_NAME = "Agro Quality AI - Python IA API"

MODEL_PATH = os.getenv("AGRO_MODEL_PATH", "modelo_entrenado/agro_model.h5")
METADATA_PATH = os.getenv("AGRO_METADATA_PATH", "modelo_entrenado/metadata.json")
MIN_CONFIDENCE = float(os.getenv("AGRO_MIN_CONFIDENCE", "0.72"))
MIN_MARGIN = float(os.getenv("AGRO_MIN_MARGIN", "0.08"))

DEFAULT_LABELS = [
    "curcuma_buena",
    "curcuma_mala",
    "jengibre_bueno",
    "jengibre_malo",
    "mango_bueno",
    "mango_malo",
    "no_reconocido",
    "palta_buena",
    "palta_mala",
]

PRODUCTS = {
    "palta": {"name": "Palta", "icon": "🥑"},
    "mango": {"name": "Mango", "icon": "🥭"},
    "jengibre": {"name": "Jengibre", "icon": "🫚"},
    "curcuma": {"name": "Cúrcuma", "icon": "🟠"},
}

app = FastAPI(title=APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = None
labels = DEFAULT_LABELS


class PredictRequest(BaseModel):
    imageBase64: str
    minConfidence: float | None = None


def normalize_text(value: str = "") -> str:
    value = str(value).lower().strip()
    replacements = {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "ñ": "n",
    }
    for a, b in replacements.items():
        value = value.replace(a, b)
    return value


def get_product_from_label(label: str):
    clean = normalize_text(label)

    if "no_reconocido" in clean or "no reconocido" in clean or "unknown" in clean:
        return None

    if "palta" in clean or "avocado" in clean or "aguacate" in clean:
        return "palta"
    if "mango" in clean:
        return "mango"
    if "jengibre" in clean or "ginger" in clean:
        return "jengibre"
    if "curcuma" in clean or "turmeric" in clean:
        return "curcuma"

    return None


def get_condition_from_label(label: str):
    clean = normalize_text(label)

    if (
        "_mala" in clean
        or "_malo" in clean
        or "mala" in clean
        or "malo" in clean
        or "podrida" in clean
        or "podrido" in clean
        or "bad" in clean
        or "rotten" in clean
        or "mold" in clean
    ):
        return "bad"

    if (
        "_buena" in clean
        or "_bueno" in clean
        or "buena" in clean
        or "bueno" in clean
        or "good" in clean
        or "fresh" in clean
    ):
        return "good"

    return "review"


def build_result(top, second=None, min_confidence=None):
    if min_confidence is None:
        min_confidence = MIN_CONFIDENCE

    label = top["label"]
    score = float(top["score"])
    second_score = float(second["score"]) if second else 0.0
    confidence = round(score * 100)
    margin = score - second_score

    product_key = get_product_from_label(label)
    condition = get_condition_from_label(label)

    if not product_key or label == "no_reconocido" or score < min_confidence or margin < MIN_MARGIN:
        return {
            "decision": "NO_RECONOCIDO",
            "status": "unknown",
            "product": "Producto no reconocido",
            "icon": "🚫",
            "quality": 0,
            "confidence": confidence,
            "damage": 100,
            "label": label,
            "message": "El objeto no pertenece a los productos aceptados o la IA no tiene confianza suficiente.",
        }

    product = PRODUCTS[product_key]

    if condition == "bad":
        return {
            "decision": "RECHAZADO",
            "status": "bad",
            "product": product["name"],
            "icon": product["icon"],
            "quality": max(0, 100 - confidence),
            "confidence": confidence,
            "damage": max(70, confidence),
            "label": label,
            "message": "El producto fue reconocido en mal estado. Se enviará al descarte.",
        }

    if condition == "good":
        return {
            "decision": "APROBADO",
            "status": "good",
            "product": product["name"],
            "icon": product["icon"],
            "quality": max(70, confidence),
            "confidence": confidence,
            "damage": max(0, 100 - confidence),
            "label": label,
            "message": "El producto fue reconocido en buen estado.",
        }

    return {
        "decision": "REVISAR",
        "status": "review",
        "product": product["name"],
        "icon": product["icon"],
        "quality": 50,
        "confidence": confidence,
        "damage": 50,
        "label": label,
        "message": "El producto fue reconocido, pero la condición no es clara.",
    }


def load_labels():
    global labels

    path = Path(METADATA_PATH)
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        labels = metadata.get("labels") or metadata.get("classes") or DEFAULT_LABELS
    else:
        labels = DEFAULT_LABELS


def load_model():
    global model

    if model is None:
        if not Path(MODEL_PATH).exists():
            raise FileNotFoundError(f"No existe el modelo: {MODEL_PATH}")

        load_labels()
        model = tf.keras.models.load_model(MODEL_PATH, compile=False)

    return model


def decode_image(image_base64: str):
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]

    raw = base64.b64decode(image_base64)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image = image.resize((224, 224))
    arr = np.array(image).astype("float32")
    arr = np.expand_dims(arr, axis=0)
    return arr


@app.get("/")
def root():
    return {
        "ok": True,
        "service": APP_NAME,
        "modelPath": MODEL_PATH,
        "metadataPath": METADATA_PATH,
    }


@app.get("/api/ai/health")
def health():
    try:
        load_model()
        return {
            "ok": True,
            "service": APP_NAME,
            "modelLoaded": model is not None,
            "labels": labels,
        }
    except Exception as e:
        return {
            "ok": False,
            "service": APP_NAME,
            "error": str(e),
        }


@app.post("/api/ai/predict")
def predict(payload: PredictRequest):
    try:
        mdl = load_model()
        arr = decode_image(payload.imageBase64)

        pred = mdl.predict(arr, verbose=0)[0]

        ranking = sorted(
            [
                {
                    "label": labels[i] if i < len(labels) else f"clase_{i}",
                    "score": float(pred[i]),
                }
                for i in range(len(pred))
            ],
            key=lambda item: item["score"],
            reverse=True,
        )

        result = build_result(
            ranking[0],
            ranking[1] if len(ranking) > 1 else None,
            payload.minConfidence,
        )

        return {
            "ok": True,
            "result": result,
            "ranking": ranking[:5],
        }

    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("agro_ai_api:app", host="127.0.0.1", port=5001, reload=True)
