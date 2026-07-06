import shutil
from pathlib import Path
import tensorflow as tf

MODEL_H5 = Path("modelo_entrenado") / "agro_model.h5"
MODEL_KERAS = Path("modelo_entrenado") / "agro_model.keras"
OUT = Path("saved_model_agro")

if OUT.exists():
    shutil.rmtree(OUT)

if MODEL_H5.exists():
    print(f"Cargando modelo: {MODEL_H5}")
    model = tf.keras.models.load_model(MODEL_H5, compile=False)
elif MODEL_KERAS.exists():
    print(f"Cargando modelo: {MODEL_KERAS}")
    model = tf.keras.models.load_model(MODEL_KERAS, compile=False)
else:
    raise FileNotFoundError("No existe modelo_entrenado/agro_model.h5 ni modelo_entrenado/agro_model.keras")

print("Exportando SavedModel para TensorFlow.js GraphModel...")

try:
    # Keras 3
    model.export(str(OUT))
except Exception:
    # Fallback
    tf.saved_model.save(model, str(OUT))

print(f"OK. SavedModel creado en: {OUT}")
print("Ahora ejecuta:")
print("tensorflowjs_converter --input_format=tf_saved_model --output_format=tfjs_graph_model saved_model_agro public/models/agro")
