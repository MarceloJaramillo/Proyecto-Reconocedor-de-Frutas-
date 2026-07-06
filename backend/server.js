import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Carga variables de entorno desde backend/.env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 4000);
const ESP32_BASE_URL = process.env.ESP32_BASE_URL || "http://10.236.170.78";
const SERVO_DELAY_MS = Number(process.env.SERVO_DELAY_MS || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const DB_PATH = path.join(__dirname, "data", "db.json");

app.use(
  cors({
    origin: [FRONTEND_ORIGIN, "http://127.0.0.1:5173", "http://localhost:5173"],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function ensureDb() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify({ hardwareEvents: [], scanHistory: [] }, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  const content = await fs.readFile(DB_PATH, "utf8");
  return JSON.parse(content || "{}");
}

async function writeDb(db) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function addHardwareEvent(event) {
  const db = await readDb();
  db.hardwareEvents = db.hardwareEvents || [];
  db.hardwareEvents.unshift({
    id: createId("evt"),
    createdAt: new Date().toISOString(),
    ...event,
  });
  db.hardwareEvents = db.hardwareEvents.slice(0, 300);
  await writeDb(db);
}

async function callEsp32(endpoint, options = {}) {
  const url = `${ESP32_BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      url,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: error.name === "AbortError" ? "Tiempo de espera agotado" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Agro Quality AI Backend/API",
    timestamp: new Date().toISOString(),
    esp32BaseUrl: ESP32_BASE_URL,
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    esp32BaseUrl: ESP32_BASE_URL,
    servoDelayMs: SERVO_DELAY_MS,
    acceptedProducts: ["palta", "mango", "jengibre", "curcuma"],
  });
});

// Consulta real al ESP32: GET /estado
app.get("/api/hardware/status", async (req, res) => {
  const esp32 = await callEsp32("/estado", { method: "GET" });

  await addHardwareEvent({
    type: "STATUS_CHECK",
    success: esp32.ok,
    endpoint: "/estado",
    response: esp32.data || null,
    error: esp32.error || null,
  });

  res.status(esp32.ok ? 200 : 503).json({
    ok: esp32.ok,
    message: esp32.ok ? "ESP32 conectado" : "ESP32 no disponible",
    esp32,
  });
});

// Enciende banda: backend -> ESP32 GET /banda/on
app.post("/api/hardware/banda/on", async (req, res) => {
  const esp32 = await callEsp32("/banda/on", { method: "GET" });

  await addHardwareEvent({
    type: "BANDA_ON",
    success: esp32.ok,
    endpoint: "/banda/on",
    requestedBy: req.body?.requestedBy || "frontend",
    response: esp32.data || null,
    error: esp32.error || null,
  });

  res.status(esp32.ok ? 200 : 502).json({
    ok: esp32.ok,
    action: "BANDA_ON",
    message: esp32.ok ? "Banda encendida" : "No se pudo encender la banda",
    esp32,
  });
});

// Apaga banda: backend -> ESP32 GET /banda/off
app.post("/api/hardware/banda/off", async (req, res) => {
  const esp32 = await callEsp32("/banda/off", { method: "GET" });

  await addHardwareEvent({
    type: "BANDA_OFF",
    success: esp32.ok,
    endpoint: "/banda/off",
    requestedBy: req.body?.requestedBy || "frontend",
    response: esp32.data || null,
    error: esp32.error || null,
  });

  res.status(esp32.ok ? 200 : 502).json({
    ok: esp32.ok,
    action: "BANDA_OFF",
    message: esp32.ok ? "Banda apagada" : "No se pudo apagar la banda",
    esp32,
  });
});

// Activa servo de descarte. Puede usarse con delay para que la fruta llegue al punto de desvío.
app.post("/api/hardware/desviar", async (req, res) => {
  const {
    delayMs = SERVO_DELAY_MS,
    reason = "producto_rechazado",
    product = "desconocido",
    quality = null,
    immediate = false,
  } = req.body || {};

  const finalDelay = immediate ? 0 : Number(delayMs || SERVO_DELAY_MS);

  await addHardwareEvent({
    type: "SERVO_SCHEDULED",
    success: true,
    endpoint: "/desviar",
    reason,
    product,
    quality,
    delayMs: finalDelay,
  });

  // Responde rápido al frontend y ejecuta el servo en segundo plano.
  res.json({
    ok: true,
    action: "SERVO_SCHEDULED",
    message: finalDelay > 0 ? `Servo programado en ${finalDelay} ms` : "Servo activado inmediatamente",
    delayMs: finalDelay,
  });

  try {
    if (finalDelay > 0) await sleep(finalDelay);

    const esp32 = await callEsp32("/desviar", {
      method: "POST",
      body: JSON.stringify({ reason, product, quality }),
    });

    await addHardwareEvent({
      type: "SERVO_EXECUTED",
      success: esp32.ok,
      endpoint: "/desviar",
      reason,
      product,
      quality,
      delayMs: finalDelay,
      response: esp32.data || null,
      error: esp32.error || null,
    });
  } catch (error) {
    await addHardwareEvent({
      type: "SERVO_ERROR",
      success: false,
      endpoint: "/desviar",
      reason,
      product,
      quality,
      delayMs: finalDelay,
      error: error.message,
    });
  }
});

// Guarda un resultado de análisis de la IA.
app.post("/api/scan/result", async (req, res) => {
  const {
    product = "desconocido",
    decision = "REVISAR",
    quality = 0,
    damage = 0,
    confidence = 0,
    darkSpots = 0,
    colorHealth = 0,
    userEmail = "sin_usuario",
    source = "frontend",
  } = req.body || {};

  const record = {
    id: createId("scan"),
    createdAt: new Date().toISOString(),
    product,
    decision,
    quality,
    damage,
    confidence,
    darkSpots,
    colorHealth,
    userEmail,
    source,
  };

  const db = await readDb();
  db.scanHistory = db.scanHistory || [];
  db.scanHistory.unshift(record);
  db.scanHistory = db.scanHistory.slice(0, 500);
  await writeDb(db);

  res.status(201).json({
    ok: true,
    message: "Resultado registrado",
    record,
  });
});

app.get("/api/scan/history", async (req, res) => {
  const db = await readDb();
  const limit = Math.min(Number(req.query.limit || 100), 500);

  res.json({
    ok: true,
    total: db.scanHistory?.length || 0,
    items: (db.scanHistory || []).slice(0, limit),
  });
});

app.delete("/api/scan/history", async (req, res) => {
  const db = await readDb();
  db.scanHistory = [];
  await writeDb(db);

  res.json({
    ok: true,
    message: "Historial limpiado",
  });
});

app.get("/api/hardware/events", async (req, res) => {
  const db = await readDb();
  const limit = Math.min(Number(req.query.limit || 100), 300);

  res.json({
    ok: true,
    total: db.hardwareEvents?.length || 0,
    items: (db.hardwareEvents || []).slice(0, limit),
  });
});

app.get("/api/stats", async (req, res) => {
  const db = await readDb();
  const history = db.scanHistory || [];

  const stats = history.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.decision === "APROBADO") acc.aprobados += 1;
      else if (item.decision === "RECHAZADO") acc.rechazados += 1;
      else if (item.decision === "NO_RECONOCIDO" || item.decision === "NO RECONOCIDO") acc.noReconocidos += 1;
      else acc.revision += 1;

      const key = item.product || "desconocido";
      acc.porProducto[key] = (acc.porProducto[key] || 0) + 1;
      return acc;
    },
    { total: 0, aprobados: 0, rechazados: 0, revision: 0, noReconocidos: 0, porProducto: {} }
  );

  res.json({ ok: true, stats });
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Backend/API de Agro Quality AI funcionando",
    rutas: [
      "GET /api/health",
      "GET /api/config",
      "GET /api/hardware/status",
      "POST /api/hardware/banda/on",
      "POST /api/hardware/banda/off",
      "POST /api/hardware/desviar",
      "POST /api/scan/result",
      "GET /api/scan/history",
      "GET /api/stats"
    ]
  });
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Ruta no encontrada",
    path: req.originalUrl,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Backend/API Agro Quality AI listo en http://localhost:${PORT}`);
  console.log(`📡 ESP32 configurado en: ${ESP32_BASE_URL}`);
  console.log(`⏱️ Delay servo: ${SERVO_DELAY_MS} ms`);
});
