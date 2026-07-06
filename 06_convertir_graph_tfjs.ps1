# Ejecutar desde la raíz del proyecto: Proyecto-Reconocedor-de-Frutas-
# Debes estar dentro de tu entorno .venv_convert o uno donde funcione tensorflowjs_converter.

Write-Host "Limpiando modelo anterior de public/models/agro..." -ForegroundColor Yellow
Remove-Item -Recurse -Force public\models\agro -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force public\models\agro | Out-Null

Write-Host "Convirtiendo SavedModel a TensorFlow.js GraphModel..." -ForegroundColor Green
tensorflowjs_converter --input_format=tf_saved_model --output_format=tfjs_graph_model saved_model_agro public\models\agro

Write-Host "Copiando metadata.json..." -ForegroundColor Green
Copy-Item modelo_entrenado\metadata.json public\models\agro\metadata.json -Force

Write-Host "Listo. Archivos generados:" -ForegroundColor Green
Get-ChildItem public\models\agro
