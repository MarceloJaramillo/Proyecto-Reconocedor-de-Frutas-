# Agro Quality AI

Sistema inteligente de clasificación de productos agrícolas usando **React**, **TensorFlow.js**, **Firebase Authentication**, **Backend/API en Node.js** y conexión con **ESP32** para controlar una banda transportadora y un servo de descarte.

El proyecto permite analizar productos en tiempo real con la cámara, clasificarlos mediante un modelo de inteligencia artificial entrenado y tomar decisiones automáticas como **aprobar**, **rechazar** o marcar como **producto no reconocido**.

---

## Objetivo del proyecto

El objetivo de **Agro Quality AI** es automatizar el control de calidad de productos agrícolas mediante visión artificial e inteligencia artificial.

La aplicación reconoce productos agrícolas aceptados, evalúa su estado y permite activar un sistema físico de descarte cuando el producto se encuentra en mal estado o no pertenece a las categorías permitidas.

---

## Productos reconocidos por la IA

El modelo fue entrenado para reconocer las siguientes clases:

```text
palta_buena
palta_mala
mango_bueno
mango_malo
jengibre_bueno
jengibre_malo
curcuma_buena
curcuma_mala
no_reconocido
```

---

## Decisiones del sistema

La IA analiza el producto y la aplicación toma una decisión automática.

| Clase detectada | Decisión | Acción |
|---|---|---|
| palta_buena | APROBADO | No activa servo |
| mango_bueno | APROBADO | No activa servo |
| jengibre_bueno | APROBADO | No activa servo |
| curcuma_buena | APROBADO | No activa servo |
| palta_mala | RECHAZADO | Activa servo |
| mango_malo | RECHAZADO | Activa servo |
| jengibre_malo | RECHAZADO | Activa servo |
| curcuma_mala | RECHAZADO | Activa servo |
| no_reconocido | NO_RECONOCIDO | Activa servo |

---

## Tecnologías utilizadas

### Frontend

- React
- Vite
- JavaScript
- TensorFlow.js
- Firebase Authentication
- HTML5 Camera API
- CSS integrado en el componente principal

### Inteligencia Artificial

- TensorFlow
- Keras
- TensorFlow.js GraphModel
- Modelo entrenado con imágenes clasificadas
- Conversión del modelo a formato compatible con navegador

### Backend

- Node.js
- Express
- API REST
- Comunicación con ESP32
- Registro de resultados de análisis

### Hardware

- ESP32
- Servo motor
- Banda transportadora
- Cámara del navegador
- Sistema de descarte automático

---

## Arquitectura general

```text
Usuario
  ↓
React + Cámara
  ↓
TensorFlow.js GraphModel
  ↓
Clasificación IA
  ↓
Decisión del sistema
  ↓
Backend/API Node.js
  ↓
ESP32
  ↓
Servo / Banda transportadora
```

---

## Estructura del proyecto

```text
Proyecto-Reconocedor-de-Frutas-
├── backend/
│   ├── server.js
│   ├── package.json
│   └── .env
│
├── public/
│   └── models/
│       └── agro/
│           ├── model.json
│           ├── metadata.json
│           ├── group1-shard1of3.bin
│           ├── group1-shard2of3.bin
│           └── group1-shard3of3.bin
│
├── src/
│   ├── App.jsx
│   ├── firebase.js
│   └── main.jsx
│
├── .env.local
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

---

## Modelo de inteligencia artificial

El modelo utilizado por la aplicación se encuentra en:

```text
public/models/agro/
```

Archivos necesarios:

```text
model.json
metadata.json
group1-shard1of3.bin
group1-shard2of3.bin
group1-shard3of3.bin
```

Estos archivos permiten que **TensorFlow.js** cargue el modelo directamente desde el navegador.

No es necesario subir al repositorio las carpetas usadas para entrenamiento o conversión, como:

```text
modelo_entrenado/
saved_model_agro/
dataset_raw/
dataset_teachable/
.venv_ai/
.venv_convert/
```

El navegador solo necesita el modelo convertido ubicado en `public/models/agro`.

---

## Funcionamiento de la IA

La aplicación usa la cámara del navegador para capturar imágenes en tiempo real.

Flujo de análisis:

```text
1. El usuario activa la cámara.
2. La aplicación toma el área central de la imagen.
3. La imagen se redimensiona a 224x224.
4. TensorFlow.js procesa la imagen.
5. El modelo devuelve probabilidades por clase.
6. La aplicación selecciona la clase con mayor confianza.
7. Se toma una decisión: APROBADO, RECHAZADO, NO_RECONOCIDO o REVISAR.
8. Si corresponde, se envía una orden al backend para activar el servo.
```

---

## Reglas de clasificación

### Producto bueno

Cuando la IA detecta un producto aceptado en buen estado:

```text
palta_buena
mango_bueno
jengibre_bueno
curcuma_buena
```

La decisión será:

```text
APROBADO
```

No se activa el servo.

---

### Producto malo

Cuando la IA detecta un producto aceptado en mal estado:

```text
palta_mala
mango_malo
jengibre_malo
curcuma_mala
```

La decisión será:

```text
RECHAZADO
```

Se activa el servo para desviar el producto.

---

### Producto no reconocido

Cuando la IA detecta un objeto que no pertenece a las clases aceptadas:

```text
no_reconocido
```

La decisión será:

```text
NO_RECONOCIDO
```

Se activa el servo para descartar el objeto.

---

## Login y roles de usuario

El sistema cuenta con autenticación y manejo de roles.

### Roles disponibles

| Rol | Permisos |
|---|---|
| Administrador | Gestionar usuarios, activar/desactivar usuarios, editar roles, eliminar usuarios, usar la IA y controlar hardware |
| Usuario | Usar el sistema de clasificación y visualizar resultados |

---

## Administrador principal

El sistema incluye un administrador principal predeterminado:

```text
admin@smartvision.com
```

Este usuario cumple las siguientes reglas:

```text
No se puede eliminar
No se puede desactivar
Mantiene siempre el rol Administrador
Puede crear usuarios
Puede editar usuarios
Puede activar o desactivar usuarios
Puede eliminar usuarios normales
Puede cambiar roles
```

---

## Login con Google / Gmail

La aplicación permite iniciar sesión con Google usando Firebase Authentication.

Funcionamiento:

```text
Si el usuario existe y está activo, puede ingresar.
Si el usuario no existe, se registra automáticamente como inactivo.
El administrador debe activar al usuario nuevo.
Si el usuario está desactivado, no puede ingresar.
```

Esto permite que el administrador tenga control sobre quién puede usar el sistema.

---

## Panel de usuarios

El administrador puede acceder al módulo de usuarios desde el menú lateral.

Funciones disponibles:

```text
Crear usuario
Editar nombre
Editar correo
Cambiar rol
Activar usuario
Desactivar usuario
Eliminar usuario
Ver estado del usuario
Ver proveedor de acceso
```

Los usuarios creados se guardan localmente en el navegador mediante `localStorage`.

---

## Instalación del frontend

Clonar el repositorio:

```bash
git clone https://github.com/MarceloJaramillo/Proyecto-Reconocedor-de-Frutas-.git
```

Entrar al proyecto:

```bash
cd Proyecto-Reconocedor-de-Frutas-
```

Instalar dependencias:

```bash
npm install
```

Ejecutar el frontend:

```bash
npm run dev
```

La aplicación estará disponible en:

```text
http://localhost:5173
```

---

## Instalación del backend

Entrar a la carpeta del backend:

```bash
cd backend
```

Instalar dependencias:

```bash
npm install
```

Crear el archivo `.env` dentro de la carpeta `backend`:

```env
PORT=4000
ESP32_BASE_URL=http://IP_DEL_ESP32
SERVO_DELAY_MS=4000
FRONTEND_ORIGIN=http://localhost:5173
```

Ejecutar el backend:

```bash
npm run dev
```

El backend estará disponible en:

```text
http://localhost:4000
```

Para probarlo:

```text
http://localhost:4000/api/health
```

---

## Variables de entorno del frontend

Crear un archivo `.env.local` en la raíz del proyecto:

```env
VITE_AGRO_MODEL_URL=/models/agro/model.json
VITE_AGRO_METADATA_URL=/models/agro/metadata.json
VITE_MIN_MODEL_CONFIDENCE=0.72
VITE_API_URL=http://localhost:4000
VITE_DELAY_SERVO_MS=4000

VITE_FIREBASE_API_KEY=TU_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=TU_PROYECTO.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=TU_PROYECTO
VITE_FIREBASE_STORAGE_BUCKET=TU_PROYECTO.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=TU_SENDER_ID
VITE_FIREBASE_APP_ID=TU_APP_ID
```

Importante: el archivo `.env.local` no debe subirse a GitHub porque contiene credenciales privadas.

---

## Backend/API

El backend se encarga de comunicar la aplicación web con el ESP32.

Rutas principales:

```text
GET    /api/health
GET    /api/config
GET    /api/hardware/status
POST   /api/hardware/banda/on
POST   /api/hardware/banda/off
POST   /api/hardware/desviar
POST   /api/scan/result
GET    /api/scan/history
GET    /api/stats
DELETE /api/scan/history
```

---

## Comunicación con ESP32

El backend envía solicitudes HTTP al ESP32.

Ejemplo de configuración:

```env
ESP32_BASE_URL=http://192.168.1.100
```

La IP debe cambiarse según la red donde esté conectado el ESP32.

Si el ESP32 no está conectado, la aplicación puede seguir clasificando productos con IA, pero no podrá activar físicamente el servo ni la banda.

---

## Hardware esperado

El sistema físico puede incluir:

```text
ESP32
Servo motor
Banda transportadora
Fuente de alimentación
Soporte para cámara
Computadora ejecutando frontend y backend
```

---

## Uso del sistema

### 1. Iniciar frontend

```bash
npm run dev
```

### 2. Iniciar backend

```bash
cd backend
npm run dev
```

### 3. Abrir aplicación

```text
http://localhost:5173
```

### 4. Iniciar sesión

Opciones disponibles:

```text
Ingresar con Google / Gmail
Ingresar como Administrador Principal
Ingresar como Usuario Demo
```

### 5. Probar modelo

Presionar:

```text
Probar carga del modelo
```

Si el modelo carga correctamente, aparecerá:

```text
MODELO_OK
```

### 6. Activar cámara

Presionar:

```text
Activar cámara
```

### 7. Iniciar análisis

Presionar:

```text
Iniciar filtro
```

---

## Buenas prácticas para mejorar el reconocimiento

Para mejorar la precisión del modelo:

```text
Usar buena iluminación
Colocar el producto centrado
Evitar fondos con mucho ruido visual
No tapar el producto con la mano
Usar una distancia similar a las imágenes de entrenamiento
Agregar más imágenes reales al dataset si la IA se equivoca
```

---

## Archivos que no deben subirse a GitHub

El `.gitignore` debe excluir:

```gitignore
node_modules/
dist/
.env
.env.local

backend/node_modules/
backend/.env
backend/data/db.json

.venv/
.venv_ai/
.venv_convert/
__pycache__/

saved_model_agro/
modelo_entrenado/
dataset_raw/
dataset_teachable/
```

---

## Archivos que sí deben subirse

Es importante subir:

```text
src/App.jsx
src/firebase.js
src/main.jsx
public/models/agro/model.json
public/models/agro/metadata.json
public/models/agro/group1-shard1of3.bin
public/models/agro/group1-shard2of3.bin
public/models/agro/group1-shard3of3.bin
backend/
package.json
package-lock.json
README.md
```

---

## Comandos útiles de Git

Ver estado:

```bash
git status
```

Agregar cambios:

```bash
git add src/App.jsx
git add src/firebase.js
git add public/models/agro
git add backend
git add package.json
git add package-lock.json
git add README.md
```

Crear commit:

```bash
git commit -m "Actualizar proyecto Agro Quality AI"
```

Subir a GitHub:

```bash
git push origin main
```

---

## Problemas comunes

### El modelo no carga

Verificar que existan estos archivos:

```text
public/models/agro/model.json
public/models/agro/metadata.json
public/models/agro/group1-shard1of3.bin
public/models/agro/group1-shard2of3.bin
public/models/agro/group1-shard3of3.bin
```

También revisar que `.env.local` tenga:

```env
VITE_AGRO_MODEL_URL=/models/agro/model.json
VITE_AGRO_METADATA_URL=/models/agro/metadata.json
```

---

### Google Login no funciona

Verificar que exista:

```text
src/firebase.js
```

y que `.env.local` tenga las variables de Firebase:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

### El backend no responde

Verificar que esté corriendo:

```bash
cd backend
npm run dev
```

y probar:

```text
http://localhost:4000/api/health
```

---

### El ESP32 no responde

Revisar la IP configurada en:

```env
ESP32_BASE_URL=http://IP_DEL_ESP32
```

También verificar que el ESP32 esté conectado a la misma red.

---

### GitHub rechaza archivos grandes

No subir:

```text
.venv_ai/
node_modules/
modelo_entrenado/
saved_model_agro/
```

Si ya fueron agregados por error:

```bash
git rm -r --cached --ignore-unmatch .venv_ai
git rm -r --cached --ignore-unmatch node_modules
git rm -r --cached --ignore-unmatch modelo_entrenado
git rm -r --cached --ignore-unmatch saved_model_agro
```

---

## Estado actual del proyecto

El proyecto actualmente incluye:

```text
Aplicación web en React
Modelo IA convertido a TensorFlow.js
Clasificación en tiempo real con cámara
Login con Google/Firebase
Administrador principal protegido
Gestión de usuarios
Backend/API en Node.js
Conexión con ESP32
Control de banda
Control de servo
Historial de análisis
```

---

## Autor

Proyecto desarrollado como parte del curso de **Cognitive Computing**.

Desarrollador:

```text
Marcelo Jaramillo
Huaman Tambine Jhonny Fernando
Edgar Nasario Mendo Céspedes 
```

---

## Nombre del proyecto

```text
Agro Quality AI
```

Sistema inteligente para control de calidad agrícola con visión artificial, inteligencia artificial y hardware IoT.
