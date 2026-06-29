import { useEffect, useMemo, useRef, useState } from "react";
import "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import {
  auth,
  googleProvider,
  signInWithPopup,
  signOut,
  hasFirebaseConfig
} from "./firebase";
import {
  verificarESP32,
  encenderBanda,
  apagarBanda,
  desviarFruta,
  desviarInmediato
} from "./esp32";
import "./App.css";

const DEFAULT_ADMIN = {
  nombre: "Administrador Principal",
  email: "admin@smartvision.com",
  rol: "Administrador",
  estado: "Activo",
  metodo: "Predeterminado",
  protegido: true
};

const STORAGE_KEYS = {
  users: "fq_users",
  history: "fq_history"
};

const FRUITS = {
  apple: {
    name: "Manzana",
    emoji: "🍎",
    colors: "rojo, verde o amarillo"
  },
  banana: {
    name: "Plátano",
    emoji: "🍌",
    colors: "amarillo o verde"
  },
  orange: {
    name: "Naranja",
    emoji: "🍊",
    colors: "naranja"
  }
};

const EMPTY_RESULT = {
  status: "waiting",
  decision: "ESPERANDO",
  title: "Sin análisis",
  fruit: "Coloca una fruta",
  emoji: "🍏",
  message: "Activa la cámara e inicia el filtro para verificar la fruta.",
  confidence: 0,
  quality: 0,
  damage: 0,
  spots: 0,
  colorHealth: 0
};

function loadStorage(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureDefaultAdmin(users) {
  const exists = users.some((user) => user.email === DEFAULT_ADMIN.email);
  return exists ? users : [DEFAULT_ADMIN, ...users];
}

function normalizeRole(role) {
  return role === "Administrador" ? "admin" : "user";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function isHealthyFruitColor(className, r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;

  if (className === "banana") {
    const yellow = r > 115 && g > 95 && b < 145 && Math.abs(r - g) < 95;
    const green = g > 85 && r > 55 && b < 135;
    return yellow || green;
  }

  if (className === "apple") {
    const red = r > 105 && r > g * 1.08 && r > b * 1.12;
    const green = g > 85 && g > b * 1.08 && g > r * 0.75;
    const yellow = r > 115 && g > 90 && b < 140;
    return saturation > 24 && (red || green || yellow);
  }

  if (className === "orange") {
    return r > 125 && g > 55 && g < 180 && b < 145 && r > b * 1.18;
  }

  return false;
}

function isDamagedPixel(r, g, b) {
  const avg = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;

  const veryDark = avg < 42;
  const darkBrown = r > 35 && g > 20 && b < 95 && avg < 130 && r >= g * 0.85 && g >= b * 1.02;
  const blackSpot = avg < 70 && saturation < 48;
  const grayRot = saturation < 18 && avg > 45 && avg < 155;

  return veryDark || darkBrown || blackSpot || grayRot;
}

function analyzeFruitQuality(video, bbox, className) {
  const [rawX, rawY, rawW, rawH] = bbox;
  const videoWidth = video.videoWidth || 1;
  const videoHeight = video.videoHeight || 1;

  const x = clamp(Math.round(rawX), 0, videoWidth - 1);
  const y = clamp(Math.round(rawY), 0, videoHeight - 1);
  const w = clamp(Math.round(rawW), 1, videoWidth - x);
  const h = clamp(Math.round(rawH), 1, videoHeight - y);

  const sampleSize = 150;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sampleSize;
  tempCanvas.height = sampleSize;

  const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      status: "review",
      decision: "REVISAR",
      title: "REVISAR",
      message: "No se pudo analizar la fruta. Intenta nuevamente.",
      quality: 50,
      damage: 0,
      spots: 0,
      colorHealth: 0
    };
  }

  ctx.drawImage(video, x, y, w, h, 0, 0, sampleSize, sampleSize);

  const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

  let usefulPixels = 0;
  let healthyPixels = 0;
  let damagedPixels = 0;
  let darkSpots = 0;

  for (let py = 0; py < sampleSize; py += 2) {
    for (let px = 0; px < sampleSize; px += 2) {
      const dx = (px - sampleSize / 2) / (sampleSize / 2);
      const dy = (py - sampleSize / 2) / (sampleSize / 2);

      if (dx * dx + dy * dy > 0.92) continue;

      const index = (py * sampleSize + px) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];

      const avg = (r + g + b) / 3;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      const healthy = isHealthyFruitColor(className, r, g, b);
      const damaged = isDamagedPixel(r, g, b);

      const looksLikeFruitArea = healthy || damaged || saturation > 30 || avg > 60;
      if (!looksLikeFruitArea) continue;

      usefulPixels += 1;

      if (healthy) healthyPixels += 1;
      if (damaged) damagedPixels += 1;
      if (avg < 58) darkSpots += 1;
    }
  }

  const safeTotal = Math.max(usefulPixels, 1);
  const damageRatio = damagedPixels / safeTotal;
  const darkRatio = darkSpots / safeTotal;
  const colorRatio = healthyPixels / safeTotal;

  const quality = Math.round(
    clamp(92 + colorRatio * 18 - damageRatio * 260 - darkRatio * 120, 0, 100)
  );

  let status = "review";
  let decision = "REVISAR";
  let title = "REVISAR";
  let message = "La fruta tiene señales dudosas. Se recomienda revisión manual.";

  if (damageRatio >= 0.18 || darkRatio >= 0.16 || quality < 48) {
    status = "bad";
    decision = "RECHAZADO";
    title = "MAL ESTADO";
    message = "Se detectaron manchas oscuras o zonas deterioradas. La fruta no pasa el filtro.";
  } else if (damageRatio <= 0.08 && darkRatio <= 0.08 && quality >= 72) {
    status = "good";
    decision = "APROBADO";
    title = "BUEN ESTADO";
    message = "La fruta presenta buen color y pocas señales de deterioro. Pasa el filtro.";
  }

  return {
    status,
    decision,
    title,
    message,
    quality,
    damage: Math.round(damageRatio * 100),
    spots: Math.round(darkRatio * 100),
    colorHealth: Math.round(colorRatio * 100)
  };
}

function pickBestFruit(predictions) {
  return predictions
    .filter((item) => FRUITS[item.class] && item.score >= 0.45)
    .sort((a, b) => b.score * b.bbox[2] * b.bbox[3] - a.score * a.bbox[2] * a.bbox[3])[0];
}

export default function App() {
  const [users, setUsers] = useState(() =>
    ensureDefaultAdmin(loadStorage(STORAGE_KEYS.users, [DEFAULT_ADMIN]))
  );
  const [history, setHistory] = useState(() => loadStorage(STORAGE_KEYS.history, []));
  const [currentUser, setCurrentUser] = useState(null);
  const [pendingGoogleUser, setPendingGoogleUser] = useState(null);
  const [registrationName, setRegistrationName] = useState("");
  const [activeView, setActiveView] = useState("scanner");

  const [newUser, setNewUser] = useState({
    nombre: "",
    email: "",
    rol: "Usuario",
    estado: "Activo",
    metodo: "Creado por admin",
    protegido: false
  });

  const [googleLoading, setGoogleLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelStatus, setModelStatus] = useState("Modelo pendiente");
  const [esp32Conectado, setEsp32Conectado] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(EMPTY_RESULT);

  const modelRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const scanningRef = useRef(false);
  const detectingRef = useRef(false);
  const lastSavedRef = useRef("");
  const lastSavedAtRef = useRef(0);

  const role = currentUser ? normalizeRole(currentUser.rol) : null;
  const isAdmin = role === "admin";

  const dashboardStats = useMemo(() => {
    const approved = history.filter((item) => item.decision === "APROBADO").length;
    const rejected = history.filter((item) => item.decision === "RECHAZADO").length;
    const review = history.filter((item) => item.decision === "REVISAR").length;

    return {
      total: history.length,
      approved,
      rejected,
      review
    };
  }, [history]);

  useEffect(() => {
    saveStorage(STORAGE_KEYS.users, users);
  }, [users]);

  useEffect(() => {
    saveStorage(STORAGE_KEYS.history, history);
  }, [history]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const verificar = () => {
      verificarESP32().then((disponible) => setEsp32Conectado(disponible));
    };
    verificar();
    const intervalo = setInterval(verificar, 10000);
    return () => clearInterval(intervalo);
  }, []);

  const loadModel = async () => {
    if (modelRef.current) return modelRef.current;

    setError("");
    setModelStatus("Cargando modelo IA...");
    setResult({
      ...EMPTY_RESULT,
      status: "loading",
      decision: "CARGANDO",
      title: "Cargando IA",
      message: "Preparando el modelo de reconocimiento de frutas."
    });

    try {
      const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
      modelRef.current = model;
      setModelReady(true);
      setModelStatus("Modelo IA listo");

      setResult({
        ...EMPTY_RESULT,
        status: "ready",
        decision: "LISTO",
        title: "IA lista",
        message: "Activa la cámara para iniciar el filtro."
      });

      return model;
    } catch (err) {
      console.error(err);
      setModelStatus("Error cargando IA");
      setError("No se pudo cargar el modelo. Revisa tu internet y las dependencias.");
      throw err;
    }
  };

  const loginAsDefaultAdmin = () => {
    const admin = users.find((user) => user.email === DEFAULT_ADMIN.email) || DEFAULT_ADMIN;
    setCurrentUser(admin);
    setActiveView("scanner");
  };

  const handleGoogleLogin = async () => {
    if (!hasFirebaseConfig) {
      setError("Firebase no está configurado.");
      return;
    }

    setGoogleLoading(true);
    setError("");

    try {
      const response = await signInWithPopup(auth, googleProvider);
      const googleUser = response.user;
      const existingUser = users.find((user) => user.email === googleUser.email);

      if (existingUser) {
        if (existingUser.estado !== "Activo") {
          setError("Tu usuario está inactivo. Solicita activación al administrador.");
          await signOut(auth);
          return;
        }

        setCurrentUser(existingUser);
        setActiveView("scanner");
        return;
      }

      setPendingGoogleUser({
        nombre: googleUser.displayName || "",
        email: googleUser.email,
        photoURL: googleUser.photoURL || ""
      });
      setRegistrationName(googleUser.displayName || "");
    } catch (err) {
      console.error(err);
      setError("No se pudo iniciar sesión con Gmail.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const completeRegistration = () => {
    if (!pendingGoogleUser) return;

    const name = registrationName.trim() || pendingGoogleUser.nombre || "Usuario nuevo";

    const createdUser = {
      nombre: name,
      email: pendingGoogleUser.email,
      rol: "Usuario",
      estado: "Activo",
      metodo: "Gmail",
      protegido: false
    };

    setUsers((prev) => ensureDefaultAdmin([...prev, createdUser]));
    setCurrentUser(createdUser);
    setPendingGoogleUser(null);
    setRegistrationName("");
    setActiveView("scanner");
  };

  const handleLogout = async () => {
    stopCamera();
    setCurrentUser(null);
    setPendingGoogleUser(null);
    setActiveView("scanner");

    try {
      await signOut(auth);
    } catch {
      // Si no hay sesión real de Firebase, no hacemos nada.
    }
  };

  const addUser = (event) => {
    event.preventDefault();

    const cleanEmail = newUser.email.trim().toLowerCase();
    const cleanName = newUser.nombre.trim();

    if (!cleanName || !cleanEmail) {
      setError("Completa nombre y correo del usuario.");
      return;
    }

    if (users.some((user) => user.email.toLowerCase() === cleanEmail)) {
      setError("Ese correo ya existe.");
      return;
    }

    setUsers((prev) => [
      ...prev,
      {
        ...newUser,
        nombre: cleanName,
        email: cleanEmail
      }
    ]);

    setNewUser({
      nombre: "",
      email: "",
      rol: "Usuario",
      estado: "Activo",
      metodo: "Creado por admin",
      protegido: false
    });
    setError("");
  };

  const deleteUser = (email) => {
    const selected = users.find((user) => user.email === email);
    if (!selected || selected.protegido) return;

    setUsers((prev) => prev.filter((user) => user.email !== email));

    if (currentUser?.email === email) {
      handleLogout();
    }
  };

  const updateUserStatus = (email, estado) => {
    setUsers((prev) =>
      prev.map((user) => (user.email === email && !user.protegido ? { ...user, estado } : user))
    );
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const syncCanvas = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return false;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    return true;
  };

  const startCamera = async () => {
    setError("");

    try {
      await loadModel();

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Navegador sin soporte de cámara");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
      setResult({
        ...EMPTY_RESULT,
        status: "ready",
        decision: "LISTO",
        title: "Cámara activa",
        message: "Coloca una manzana, plátano o naranja frente al filtro."
      });
    } catch (err) {
      console.error(err);
      setError("No se pudo activar la cámara. Acepta el permiso del navegador.");
    }
  };

  const stopScanning = () => {
    scanningRef.current = false;
    detectingRef.current = false;
    setScanning(false);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };

  const stopCamera = () => {
    stopScanning();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    clearCanvas();
    setCameraOn(false);
    setResult(EMPTY_RESULT);
  };

  const drawEmpty = () => {
    const canvas = canvasRef.current;
    if (!canvas || !syncCanvas()) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const boxWidth = Math.min(canvas.width - 60, 560);
    const boxHeight = 96;
    const x = (canvas.width - boxWidth) / 2;
    const y = (canvas.height - boxHeight) / 2;

    ctx.fillStyle = "rgba(6, 19, 16, 0.76)";
    drawRoundRect(ctx, x, y, boxWidth, boxHeight, 24);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 28px Arial";
    ctx.fillText("Coloca una fruta en el filtro", canvas.width / 2, y + 40);

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "500 18px Arial";
    ctx.fillText("Manzana · Plátano · Naranja", canvas.width / 2, y + 68);
    ctx.textAlign = "left";
  };

  const drawDetection = (prediction, qualityResult) => {
    const canvas = canvasRef.current;
    if (!canvas || !syncCanvas()) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const [x, y, w, h] = prediction.bbox;
    const color =
      qualityResult.status === "good"
        ? "#22c55e"
        : qualityResult.status === "bad"
          ? "#ef4444"
          : "#f59e0b";

    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    const label = `${FRUITS[prediction.class].name} · ${qualityResult.title}`;
    ctx.font = "700 28px Arial";
    const textWidth = ctx.measureText(label).width;
    const labelWidth = textWidth + 34;
    const labelHeight = 48;
    const labelX = clamp(x, 12, canvas.width - labelWidth - 12);
    const labelY = y > 62 ? y - 18 : y + 64;

    ctx.fillStyle = "rgba(6, 19, 16, 0.88)";
    drawRoundRect(ctx, labelX, labelY - 40, labelWidth, labelHeight, 16);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillText(label, labelX + 17, labelY - 8);
  };

  const saveResultToHistory = (fruitInfo, qualityResult, confidence) => {
    if (!currentUser) return;
    if (!["APROBADO", "RECHAZADO", "REVISAR"].includes(qualityResult.decision)) return;

    const signature = `${fruitInfo.name}-${qualityResult.decision}`;
    const now = new Date();

    if (lastSavedRef.current === signature && now.getTime() - lastSavedAtRef.current < 5000) {
      return;
    }

    lastSavedRef.current = signature;
    lastSavedAtRef.current = now.getTime();

    // Fruta rechazada: activar servo con delay para que llegue al punto de desvío
    if (qualityResult.decision === "RECHAZADO") {
      desviarFruta();
    }

    const id =
      globalThis.crypto && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID()
        : String(now.getTime());

    setHistory((prev) => [
      {
        id,
        fecha: now.toLocaleString("es-PE"),
        usuario: currentUser.nombre,
        fruta: fruitInfo.name,
        decision: qualityResult.decision,
        calidad: qualityResult.quality,
        danio: qualityResult.damage,
        confianza: confidence
      },
      ...prev.slice(0, 49)
    ]);
  };

  const scanFrame = async () => {
    if (!scanningRef.current) return;

    if (detectingRef.current) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const video = videoRef.current;
    const model = modelRef.current;

    if (!video || !model || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    detectingRef.current = true;

    try {
      const predictions = await model.detect(video);
      const bestFruit = pickBestFruit(predictions);

      if (!bestFruit) {
        drawEmpty();

        setResult({
          ...EMPTY_RESULT,
          status: "searching",
          decision: "SIN FRUTA",
          title: "Buscando fruta",
          message: "El sistema solo acepta manzana, plátano o naranja."
        });
      } else {
        const qualityResult = analyzeFruitQuality(video, bestFruit.bbox, bestFruit.class);
        const fruitInfo = FRUITS[bestFruit.class];
        const confidence = Math.round(bestFruit.score * 100);

        drawDetection(bestFruit, qualityResult);

        setResult({
          ...qualityResult,
          fruit: fruitInfo.name,
          emoji: fruitInfo.emoji,
          confidence
        });

        saveResultToHistory(fruitInfo, qualityResult, confidence);
      }
    } catch (err) {
      console.error(err);
      setError("Ocurrió un error durante el filtro. Detén e inicia nuevamente.");
    } finally {
      detectingRef.current = false;

      if (scanningRef.current) {
        setTimeout(() => {
          animationRef.current = requestAnimationFrame(scanFrame);
        }, 450);
      }
    }
  };

  const startScanning = async () => {
    setError("");

    try {
      if (!cameraOn) {
        await startCamera();
      }

      await loadModel();

      scanningRef.current = true;
      lastSavedRef.current = "";
      lastSavedAtRef.current = 0;
      setScanning(true);

      setResult({
        ...EMPTY_RESULT,
        status: "searching",
        decision: "ESCANEANDO",
        title: "Filtro activo",
        message: "Mantén la fruta dentro de la cámara para evaluar su estado."
      });

      animationRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      console.error(err);
      setError("No se pudo iniciar el filtro. Revisa cámara, permisos o conexión.");
    }
  };

  if (!currentUser && !pendingGoogleUser) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="login-hero">
            <span className="project-pill">Cognitive Computing Project</span>
            <div className="logo-orb">🍍</div>
            <h1>Fruit Quality AI</h1>
            <p>
              Plataforma con cámara e inteligencia artificial para verificar si una fruta está en
              buen estado antes de pasar el filtro.
            </p>

            <div className="features-row">
              <span>🍎 Frutas</span>
              <span>📷 Cámara</span>
              <span>🤖 IA</span>
              <span>✅ Calidad</span>
            </div>
          </div>

          <div className="login-panel">
            <span className="section-tag">Acceso al sistema</span>
            <h2>Ingresa para usar el filtro</h2>
            <p>
              Los usuarios nuevos ingresan con Gmail y completan su registro. El administrador
              predeterminado ya existe.
            </p>

            <div className="login-actions">
              <button className="primary-button" onClick={handleGoogleLogin} disabled={googleLoading}>
                {googleLoading ? "Conectando..." : "Ingresar / Registrarse con Gmail"}
              </button>

              <button className="secondary-button" onClick={loginAsDefaultAdmin}>
                Ingresar como Administrador
              </button>
            </div>

            {error && <div className="alert-box">{error}</div>}

            <div className="admin-info">
              <strong>Administrador predeterminado</strong>
              <span>admin@smartvision.com</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (pendingGoogleUser) {
    return (
      <main className="login-page">
        <section className="registration-card">
          <span className="section-tag">Registro de usuario</span>
          <h1>Completa tu registro</h1>
          <p>Tu cuenta Gmail fue detectada. Confirma tu nombre para crear tu usuario normal.</p>

          <div className="register-email">{pendingGoogleUser.email}</div>

          <label className="form-label">
            Nombre completo
            <input
              value={registrationName}
              onChange={(event) => setRegistrationName(event.target.value)}
              placeholder="Ejemplo: Marcelo Jaramillo"
            />
          </label>

          <div className="register-actions">
            <button className="primary-button" onClick={completeRegistration}>
              Crear mi usuario
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setPendingGoogleUser(null);
                setRegistrationName("");
              }}
            >
              Cancelar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-small">🍍</div>
          <div>
            <strong>Fruit Quality AI</strong>
            <span>{isAdmin ? "Administrador" : "Usuario"}</span>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={activeView === "scanner" ? "active" : ""}
            onClick={() => setActiveView("scanner")}
          >
            📷 Verificar fruta
          </button>

          <button
            className={activeView === "history" ? "active" : ""}
            onClick={() => setActiveView("history")}
          >
            📋 Historial
          </button>

          {isAdmin && (
            <button
              className={activeView === "users" ? "active" : ""}
              onClick={() => setActiveView("users")}
            >
              👥 Usuarios
            </button>
          )}
        </nav>

        <div className="user-card">
          <span>Sesión activa</span>
          <strong>{currentUser.nombre}</strong>
          <small>{currentUser.email}</small>
        </div>

        <button className="logout-button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </aside>

      <section className="content">
        <header className="content-header">
          <div>
            <span className="section-tag">Filtro inteligente de frutas</span>
            <h1>
              {activeView === "scanner" && "Verifica si una fruta está en buen estado"}
              {activeView === "history" && "Historial de verificaciones"}
              {activeView === "users" && "Gestión de usuarios"}
            </h1>
          </div>

          <div className="header-indicators">
            <div className="model-status">
              <span className={modelReady ? "dot ready" : "dot"} />
              {modelStatus}
            </div>
            <div className="model-status">
              <span
                className={
                  esp32Conectado === true
                    ? "dot ready"
                    : esp32Conectado === false
                      ? "dot error"
                      : "dot"
                }
              />
              {esp32Conectado === null
                ? "ESP32 verificando..."
                : esp32Conectado
                  ? "ESP32 conectado"
                  : "ESP32 sin conexión"}
            </div>
          </div>
        </header>

        {activeView === "scanner" && (
          <section className="scanner-grid">
            <div className="camera-card">
              <div className={`camera-stage ${cameraOn ? "on" : ""}`}>
                {!cameraOn && (
                  <div className="camera-empty">
                    <div>📷</div>
                    <h2>Cámara apagada</h2>
                    <p>Activa la cámara y coloca una fruta frente al filtro.</p>
                  </div>
                )}

                <video ref={videoRef} className="video-feed" muted playsInline />
                <canvas ref={canvasRef} className="overlay-canvas" />
                {scanning && <span className="scan-line" />}
              </div>

              <div className="control-grid">
                <button className="blue-button" onClick={startCamera} disabled={cameraOn}>
                  Activar cámara
                </button>
                <button className="green-button" onClick={startScanning} disabled={scanning}>
                  Iniciar filtro
                </button>
                <button className="yellow-button" onClick={stopScanning} disabled={!scanning}>
                  Detener filtro
                </button>
                <button className="red-button" onClick={stopCamera} disabled={!cameraOn}>
                  Apagar cámara
                </button>
              </div>

              <div className="esp32-controls">
                <span className="esp32-label">Control ESP32</span>
                <div className="esp32-buttons">
                  <button className="esp32-button banda-on" onClick={encenderBanda}>
                    ▶️ Encender banda
                  </button>
                  <button className="esp32-button banda-off" onClick={apagarBanda}>
                    ⏹️ Apagar banda
                  </button>
                  <button className="esp32-button servo-test" onClick={desviarInmediato}>
                    🧪 Probar servo
                  </button>
                </div>
              </div>

              {error && <div className="alert-box">{error}</div>}
            </div>

            <aside className={`result-panel ${result.status}`}>
              <div className="result-top">
                <span className="result-emoji">{result.emoji}</span>
                <div>
                  <p>Resultado del filtro</p>
                  <h2>{result.decision}</h2>
                </div>
              </div>

              <div className="decision-card">
                <span>{result.title}</span>
                <strong>{result.fruit}</strong>
                <p>{result.message}</p>
              </div>

              <div className="quality-card">
                <div className="quality-title">
                  <span>Calidad estimada</span>
                  <strong>{result.quality}%</strong>
                </div>
                <div className="quality-bar">
                  <div style={{ width: `${clamp(result.quality, 0, 100)}%` }} />
                </div>
              </div>

              <div className="metric-grid">
                <div>
                  <span>Confianza IA</span>
                  <strong>{result.confidence}%</strong>
                </div>
                <div>
                  <span>Daño visual</span>
                  <strong>{result.damage}%</strong>
                </div>
                <div>
                  <span>Manchas</span>
                  <strong>{result.spots}%</strong>
                </div>
                <div>
                  <span>Color sano</span>
                  <strong>{result.colorHealth}%</strong>
                </div>
              </div>

              <div className="support-card">
                <strong>Frutas soportadas</strong>
                <p>Manzana, plátano y naranja. Si colocas otro objeto, el filtro lo ignora.</p>
              </div>
            </aside>
          </section>
        )}

        {activeView === "history" && (
          <section className="history-layout">
            <div className="stats-grid">
              <div>
                <span>Total</span>
                <strong>{dashboardStats.total}</strong>
              </div>
              <div>
                <span>Aprobadas</span>
                <strong>{dashboardStats.approved}</strong>
              </div>
              <div>
                <span>Rechazadas</span>
                <strong>{dashboardStats.rejected}</strong>
              </div>
              <div>
                <span>Revisar</span>
                <strong>{dashboardStats.review}</strong>
              </div>
            </div>

            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Fruta</th>
                    <th>Resultado</th>
                    <th>Calidad</th>
                    <th>Confianza</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr>
                      <td colSpan="6">Aún no hay verificaciones registradas.</td>
                    </tr>
                  )}

                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>{item.fecha}</td>
                      <td>{item.usuario}</td>
                      <td>{item.fruta}</td>
                      <td>
                        <span className={`badge ${item.decision.toLowerCase()}`}>
                          {item.decision}
                        </span>
                      </td>
                      <td>{item.calidad}%</td>
                      <td>{item.confianza}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeView === "users" && isAdmin && (
          <section className="users-layout">
            <form className="form-card" onSubmit={addUser}>
              <h2>Crear usuario</h2>

              <label className="form-label">
                Nombre
                <input
                  value={newUser.nombre}
                  onChange={(event) => setNewUser({ ...newUser, nombre: event.target.value })}
                  placeholder="Nombre del usuario"
                />
              </label>

              <label className="form-label">
                Correo
                <input
                  value={newUser.email}
                  onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
                  placeholder="correo@ejemplo.com"
                />
              </label>

              <label className="form-label">
                Rol
                <select
                  value={newUser.rol}
                  onChange={(event) => setNewUser({ ...newUser, rol: event.target.value })}
                >
                  <option>Usuario</option>
                  <option>Administrador</option>
                </select>
              </label>

              <button className="primary-button" type="submit">
                Crear usuario
              </button>
            </form>

            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.email}>
                      <td>{user.nombre}</td>
                      <td>{user.email}</td>
                      <td>{user.rol}</td>
                      <td>
                        <select
                          value={user.estado}
                          disabled={user.protegido}
                          onChange={(event) => updateUserStatus(user.email, event.target.value)}
                        >
                          <option>Activo</option>
                          <option>Inactivo</option>
                        </select>
                      </td>
                      <td>
                        <button
                          className="mini-danger"
                          disabled={user.protegido}
                          onClick={() => deleteUser(user.email)}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
