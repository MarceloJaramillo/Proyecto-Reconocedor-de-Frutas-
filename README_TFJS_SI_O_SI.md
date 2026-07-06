# TensorFlow.js sí o sí - solución GraphModel

Tu carpeta `public/models/agro` existe, pero el modelo convertido desde H5 está fallando en el navegador.
La solución es convertir el modelo como **GraphModel**, que TensorFlow.js carga con `tf.loadGraphModel`.

## 1. Copia estos archivos a la raíz de tu proyecto

- `05_exportar_savedmodel.py`
- `06_convertir_graph_tfjs.ps1`

La raíz es donde están:

```text
backend/
src/
modelo_entrenado/
public/
package.json
```

## 2. Exporta SavedModel

Activa tu entorno donde tienes TensorFlow instalado. Puede ser `.venv` o `.venv_ai`.

```powershell
.\.venv\Scripts\activate
python 05_exportar_savedmodel.py
```

Si usas `.venv_ai`:

```powershell
.\.venv_ai\Scripts\activate
python 05_exportar_savedmodel.py
```

Esto crea:

```text
saved_model_agro/
```

## 3. Convierte a TensorFlow.js GraphModel

Activa tu entorno de conversión `.venv_convert`:

```powershell
.\.venv_convert\Scripts\activate
```

Luego ejecuta:

```powershell
.\06_convertir_graph_tfjs.ps1
```

Debe quedar:

```text
public/models/agro/
├── model.json
├── metadata.json
├── group1-shard1of...
└── ...
```

## 4. En React

Tu `App.jsx` debe cargar primero con:

```js
model = await tf.loadGraphModel("/models/agro/model.json");
```

y predecir con:

```js
const prediction = model.execute(input);
```

## 5. Reinicia Vite

```powershell
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue
npm run dev
```
