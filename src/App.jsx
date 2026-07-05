import { useEffect, useMemo, useRef, useState } from "react";
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

const PRODUCTS = {
  avocado: {
    name: "Palta",
    label: "Palta (aguacate)",
    emoji: "🥑",
    colors: "verde oscuro, verde o marrón natural"
  },
  mango: {
    name: "Mango",
    label: "Mango",
    emoji: "🥭",
    colors: "amarillo, naranja, rojizo o verde"
  },
  ginger: {
    name: "Jengibre",
    label: "Jengibre",
    emoji: "🫚",
    colors: "beige, marrón claro o crema"
  },
  turmeric: {
    name: "Cúrcuma",
    label: "Cúrcuma",
    emoji: "🟠",
    colors: "naranja intenso, amarillo oscuro o marrón anaranjado"
  }
};

const ACCEPTED_PRODUCTS_TEXT = "Palta, mango, jengibre y cúrcuma";
const REJECT_DECISIONS = ["RECHAZADO", "NO RECONOCIDO"];

const EMPTY_RESULT = {
  status: "waiting",
  decision: "ESPERANDO",
  title: "Sin análisis",
  fruit: "Coloca un producto",
  emoji: "🥑",
  message: "Activa la cámara e inicia el filtro para verificar palta, mango, jengibre o cúrcuma.",
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

function getPixelInfo(r, g, b) {
  const avg = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;

  const green = g > 62 && g >= r * 0.82 && g > b * 1.08;
  const darkGreen = g > 42 && g >= r * 0.78 && g > b * 1.12 && avg < 145;
  const yellow = r > 118 && g > 94 && b < 135 && Math.abs(r - g) < 115;
  const orange = r > 125 && g > 55 && g < 185 && b < 130 && r > b * 1.22;
  const red = r > 115 && r > g * 1.12 && r > b * 1.18;
  const beige =
    r > 74 &&
    g > 48 &&
    b > 28 &&
    avg > 64 &&
    avg < 215 &&
    sat < 92 &&
    r >= g * 0.92 &&
    g >= b * 0.82;
  const lightBrown =
    r > 65 &&
    g > 38 &&
    b > 18 &&
    avg > 55 &&
    avg < 175 &&
    sat < 105 &&
    r >= g * 0.9 &&
    g >= b * 0.75;
  const turmeric = r > 100 && g > 42 && b < 112 && r > g * 1.03 && g >= b * 0.72;

  const veryDark = avg < 38;
  const blackSpot = avg < 62 && sat < 50;
  const grayRot = sat < 18 && avg > 42 && avg < 155;
  const rottenBrown = r > 35 && g > 18 && b < 92 && avg < 112 && r >= g * 0.82 && g >= b * 1.0;

  const saturatedObject = sat > 30 && avg > 38 && avg < 235;
  const knownProductColor = green || darkGreen || yellow || orange || red || beige || lightBrown || turmeric;
  const foreground = knownProductColor || saturatedObject || veryDark || blackSpot || rottenBrown;

  return {
    avg,
    sat,
    green,
    darkGreen,
    yellow,
    orange,
    red,
    beige,
    lightBrown,
    turmeric,
    veryDark,
    blackSpot,
    grayRot,
    rottenBrown,
    foreground
  };
}

function buildQualityByProduct(productKey, stats) {
  const total = Math.max(stats.foreground, 1);

  const ratios = {
    green: stats.green / total,
    darkGreen: stats.darkGreen / total,
    yellow: stats.yellow / total,
    orange: stats.orange / total,
    red: stats.red / total,
    beige: stats.beige / total,
    lightBrown: stats.lightBrown / total,
    turmeric: stats.turmeric / total,
    veryDark: stats.veryDark / total,
    blackSpot: stats.blackSpot / total,
    grayRot: stats.grayRot / total,
    rottenBrown: stats.rottenBrown / total
  };

  let colorHealth = 0;
  let damageRatio = 0;

  // MODO ESTRICTO: antes estaba muy permisivo y por eso una fruta dañada podía salir APROBADA.
  // Ahora cualquier porcentaje relevante de manchas negras/marrones baja fuerte la calidad.
  const spotRatio = clamp(ratios.veryDark + ratios.blackSpot, 0, 1);
  const rotRatio = clamp(ratios.rottenBrown + ratios.grayRot * 0.65, 0, 1);

  if (productKey === "avocado") {
    // Palta: se acepta verde/verde oscuro, pero se castigan manchas negras y zonas podridas.
    colorHealth = clamp(ratios.green + ratios.darkGreen * 0.85 + ratios.lightBrown * 0.12, 0, 1);
    damageRatio = clamp(
      ratios.veryDark * 1.45 +
        ratios.blackSpot * 1.55 +
        ratios.rottenBrown * 1.15 +
        ratios.grayRot * 0.5,
      0,
      1
    );
  }

  if (productKey === "mango") {
    // Mango: se acepta amarillo/naranja/rojizo/verde, pero las manchas oscuras son rechazo rápido.
    colorHealth = clamp(ratios.yellow + ratios.orange + ratios.red * 0.75 + ratios.green * 0.35, 0, 1);
    damageRatio = clamp(
      ratios.veryDark * 1.55 +
        ratios.blackSpot * 1.6 +
        ratios.rottenBrown * 1.3 +
        ratios.grayRot * 0.55,
      0,
      1
    );
  }

  if (productKey === "ginger") {
    // Jengibre: su color natural es beige/marrón claro, por eso se castiga más lo negro/gris.
    colorHealth = clamp(ratios.beige + ratios.lightBrown * 0.8, 0, 1);
    damageRatio = clamp(
      ratios.veryDark * 1.45 +
        ratios.blackSpot * 1.35 +
        ratios.grayRot * 0.75 +
        ratios.rottenBrown * 0.35,
      0,
      1
    );
  }

  if (productKey === "turmeric") {
    // Cúrcuma: se acepta naranja/amarillo intenso, se rechaza si aparecen zonas negras o grises.
    colorHealth = clamp(ratios.turmeric + ratios.orange * 0.8 + ratios.yellow * 0.55 + ratios.lightBrown * 0.15, 0, 1);
    damageRatio = clamp(
      ratios.veryDark * 1.45 +
        ratios.blackSpot * 1.35 +
        ratios.grayRot * 0.7 +
        ratios.rottenBrown * 0.35,
      0,
      1
    );
  }

  const quality = Math.round(
    clamp(100 + colorHealth * 8 - damageRatio * 360 - spotRatio * 120 - rotRatio * 80, 0, 100)
  );

  let status = "review";
  let decision = "REVISAR";
  let title = "REVISAR";
  let message = "El producto presenta señales dudosas. Se recomienda revisión manual.";

  // Rechazo más sensible para la demo: si hay manchas visibles, no debe salir como buen estado.
  const mustReject =
    damageRatio >= 0.085 ||
    spotRatio >= 0.045 ||
    ratios.blackSpot >= 0.028 ||
    ratios.veryDark >= 0.04 ||
    rotRatio >= 0.07 ||
    quality < 62;

  const clearlyGood =
    damageRatio <= 0.035 &&
    spotRatio <= 0.022 &&
    ratios.blackSpot <= 0.014 &&
    ratios.veryDark <= 0.025 &&
    rotRatio <= 0.035 &&
    quality >= 76 &&
    colorHealth >= 0.12;

  if (mustReject) {
    status = "bad";
    decision = "RECHAZADO";
    title = "MAL ESTADO";
    message = "Se detectaron manchas oscuras, zonas dañadas o deterioro visual. El producto será enviado al descarte.";
  } else if (clearlyGood) {
    status = "good";
    decision = "APROBADO";
    title = "BUEN ESTADO";
    message = "El producto presenta color aceptable y no muestra deterioro relevante. Pasa el filtro.";
  }

  return {
    status,
    decision,
    title,
    message,
    quality,
    damage: Math.round(damageRatio * 100),
    spots: Math.round(spotRatio * 100),
    colorHealth: Math.round(colorHealth * 100)
  };
}

function analyzeAgroProduct(video) {
  const videoWidth = video.videoWidth || 1280;
  const videoHeight = video.videoHeight || 720;

  const sampleWidth = 260;
  const sampleHeight = 190;
  const cropScale = 0.78;
  const cropW = videoWidth * cropScale;
  const cropH = videoHeight * cropScale;
  const cropX = (videoWidth - cropW) / 2;
  const cropY = (videoHeight - cropH) / 2;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sampleWidth;
  tempCanvas.height = sampleHeight;

  const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, sampleWidth, sampleHeight);
  const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);

  const stats = {
    foreground: 0,
    green: 0,
    darkGreen: 0,
    yellow: 0,
    orange: 0,
    red: 0,
    beige: 0,
    lightBrown: 0,
    turmeric: 0,
    veryDark: 0,
    blackSpot: 0,
    grayRot: 0,
    rottenBrown: 0,
    minX: sampleWidth,
    minY: sampleHeight,
    maxX: 0,
    maxY: 0
  };

  for (let y = 0; y < sampleHeight; y += 2) {
    for (let x = 0; x < sampleWidth; x += 2) {
      const nx = (x - sampleWidth / 2) / (sampleWidth / 2);
      const ny = (y - sampleHeight / 2) / (sampleHeight / 2);
      const centerWeight = nx * nx + ny * ny;

      if (centerWeight > 1.05) continue;

      const index = (y * sampleWidth + x) * 4;
      const info = getPixelInfo(data[index], data[index + 1], data[index + 2]);

      if (!info.foreground) continue;

      stats.foreground += 1;
      if (info.green) stats.green += 1;
      if (info.darkGreen) stats.darkGreen += 1;
      if (info.yellow) stats.yellow += 1;
      if (info.orange) stats.orange += 1;
      if (info.red) stats.red += 1;
      if (info.beige) stats.beige += 1;
      if (info.lightBrown) stats.lightBrown += 1;
      if (info.turmeric) stats.turmeric += 1;
      if (info.veryDark) stats.veryDark += 1;
      if (info.blackSpot) stats.blackSpot += 1;
      if (info.grayRot) stats.grayRot += 1;
      if (info.rottenBrown) stats.rottenBrown += 1;

      stats.minX = Math.min(stats.minX, x);
      stats.minY = Math.min(stats.minY, y);
      stats.maxX = Math.max(stats.maxX, x);
      stats.maxY = Math.max(stats.maxY, y);
    }
  }

  const minForeground = 260;
  if (stats.foreground < minForeground) {
    return {
      found: false,
      status: "searching",
      decision: "SIN PRODUCTO",
      title: "Buscando producto",
      product: "Coloca un producto",
      emoji: "🥑",
      message: `El sistema acepta: ${ACCEPTED_PRODUCTS_TEXT}.`,
      confidence: 0,
      quality: 0,
      damage: 0,
      spots: 0,
      colorHealth: 0,
      bbox: null
    };
  }

  const total = Math.max(stats.foreground, 1);
  const ratios = {
    green: stats.green / total,
    darkGreen: stats.darkGreen / total,
    yellow: stats.yellow / total,
    orange: stats.orange / total,
    red: stats.red / total,
    beige: stats.beige / total,
    lightBrown: stats.lightBrown / total,
    turmeric: stats.turmeric / total
  };

  const widthRatio = Math.max(stats.maxX - stats.minX, 1) / sampleWidth;
  const heightRatio = Math.max(stats.maxY - stats.minY, 1) / sampleHeight;
  const objectPresence = clamp(stats.foreground / (sampleWidth * sampleHeight * 0.25), 0, 1);
  const ovalBonus = widthRatio > 0.22 && heightRatio > 0.22 ? 0.08 : 0;

  const scores = {
    avocado: clamp((ratios.green * 0.65 + ratios.darkGreen * 0.55 + ratios.lightBrown * 0.12 + ovalBonus) * 100, 0, 100),
    mango: clamp((ratios.yellow * 0.5 + ratios.orange * 0.58 + ratios.red * 0.28 + ratios.green * 0.16 + ovalBonus) * 100, 0, 100),
    ginger: clamp((ratios.beige * 0.65 + ratios.lightBrown * 0.58 - ratios.orange * 0.18 - ratios.green * 0.12) * 100, 0, 100),
    turmeric: clamp((ratios.turmeric * 0.65 + ratios.orange * 0.5 + ratios.yellow * 0.18 - ratios.green * 0.18) * 100, 0, 100)
  };

  const productKey = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  const rawConfidence = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][1];
  const confidence = Math.round(clamp(rawConfidence * 0.9 + objectPresence * 18, 0, 99));

  const x = cropX + (stats.minX / sampleWidth) * cropW;
  const y = cropY + (stats.minY / sampleHeight) * cropH;
  const w = ((stats.maxX - stats.minX) / sampleWidth) * cropW;
  const h = ((stats.maxY - stats.minY) / sampleHeight) * cropH;
  const bbox = [clamp(x, 0, videoWidth - 1), clamp(y, 0, videoHeight - 1), clamp(w, 40, videoWidth), clamp(h, 40, videoHeight)];

  if (confidence < 32) {
    return {
      found: true,
      recognized: false,
      status: "unknown",
      decision: "NO RECONOCIDO",
      title: "PRODUCTO NO RECONOCIDO",
      product: "Fuera de lista",
      emoji: "🚫",
      message: `El objeto detectado no corresponde a ${ACCEPTED_PRODUCTS_TEXT}. Se enviará al descarte.`,
      confidence,
      quality: 0,
      damage: 0,
      spots: 0,
      colorHealth: 0,
      bbox
    };
  }

  const productInfo = PRODUCTS[productKey];
  const qualityResult = buildQualityByProduct(productKey, stats);

  return {
    found: true,
    recognized: true,
    productKey,
    productInfo,
    bbox,
    confidence,
    ...qualityResult
  };
}

function getBadgeClass(decision) {
  return decision.toLowerCase().replaceAll(" ", "-");
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
    const unknown = history.filter((item) => item.decision === "NO RECONOCIDO").length;

    return {
      total: history.length,
      approved,
      rejected,
      review,
      unknown
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
    setError("");
    setModelStatus("Motor visual listo");
    setModelReady(true);

    setResult((prev) => ({
      ...prev,
      status: prev.status === "waiting" ? "ready" : prev.status,
      decision: prev.decision === "ESPERANDO" ? "LISTO" : prev.decision,
      title: prev.title === "Sin análisis" ? "Motor visual listo" : prev.title,
      message:
        prev.status === "waiting"
          ? `Activa la cámara para verificar ${ACCEPTED_PRODUCTS_TEXT}.`
          : prev.message
    }));

    return true;
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
        message: `Coloca ${ACCEPTED_PRODUCTS_TEXT} frente al filtro.`
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
    ctx.fillText("Coloca un producto en el filtro", canvas.width / 2, y + 40);

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "500 18px Arial";
    ctx.fillText("Palta · Mango · Jengibre · Cúrcuma", canvas.width / 2, y + 68);
    ctx.textAlign = "left";
  };

  const drawDetection = (analysis) => {
    const canvas = canvasRef.current;
    if (!canvas || !syncCanvas()) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!analysis?.bbox) return;

    const [x, y, w, h] = analysis.bbox;
    const color =
      analysis.status === "good"
        ? "#22c55e"
        : analysis.status === "bad" || analysis.status === "unknown"
          ? "#ef4444"
          : "#f59e0b";

    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    const productLabel = analysis.recognized ? analysis.productInfo.name : "No reconocido";
    const label = `${productLabel} · ${analysis.title}`;
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

  const saveResultToHistory = (productInfo, analysis) => {
    if (!currentUser) return;
    if (!["APROBADO", "RECHAZADO", "REVISAR", "NO RECONOCIDO"].includes(analysis.decision)) return;

    const productName = productInfo?.name || "No reconocido";
    const signature = `${productName}-${analysis.decision}`;
    const now = new Date();

    if (lastSavedRef.current === signature && now.getTime() - lastSavedAtRef.current < 5000) {
      return;
    }

    lastSavedRef.current = signature;
    lastSavedAtRef.current = now.getTime();

    // Producto rechazado o fuera de lista: activar servo con delay para que llegue al punto de desvío.
    if (REJECT_DECISIONS.includes(analysis.decision)) {
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
        producto: productName,
        decision: analysis.decision,
        calidad: analysis.quality,
        danio: analysis.damage,
        confianza: analysis.confidence
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

    if (!video || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    detectingRef.current = true;

    try {
      const analysis = analyzeAgroProduct(video);

      if (!analysis || !analysis.found) {
        drawEmpty();

        setResult({
          ...EMPTY_RESULT,
          status: "searching",
          decision: "SIN PRODUCTO",
          title: "Buscando producto",
          message: `El sistema acepta: ${ACCEPTED_PRODUCTS_TEXT}.`
        });
      } else {
        drawDetection(analysis);

        setResult({
          status: analysis.status,
          decision: analysis.decision,
          title: analysis.title,
          fruit: analysis.recognized ? analysis.productInfo.name : "Producto no reconocido",
          emoji: analysis.recognized ? analysis.productInfo.emoji : "🚫",
          message: analysis.message,
          confidence: analysis.confidence,
          quality: analysis.quality,
          damage: analysis.damage,
          spots: analysis.spots,
          colorHealth: analysis.colorHealth
        });

        saveResultToHistory(analysis.recognized ? analysis.productInfo : null, analysis);
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
        message: "Mantén el producto dentro de la cámara para evaluar su estado."
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
            <div className="logo-orb">🥑</div>
            <h1>Agro Quality AI</h1>
            <p>
              Plataforma con cámara e inteligencia artificial para verificar palta, mango, jengibre y cúrcuma antes de pasar el filtro.
            </p>

            <div className="features-row">
              <span>🥑 Palta</span>
              <span>🥭 Mango</span>
              <span>🫚 Jengibre</span>
              <span>🟠 Cúrcuma</span>
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
          <div className="logo-small">🥑</div>
          <div>
            <strong>Agro Quality AI</strong>
            <span>{isAdmin ? "Administrador" : "Usuario"}</span>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={activeView === "scanner" ? "active" : ""}
            onClick={() => setActiveView("scanner")}
          >
            📷 Verificar producto
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
            <span className="section-tag">Filtro inteligente agroindustrial</span>
            <h1>
              {activeView === "scanner" && "Verifica si el producto está en buen estado"}
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
                    <p>Activa la cámara y coloca palta, mango, jengibre o cúrcuma frente al filtro.</p>
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
                <strong>Productos aceptados</strong>
                <p>Palta, mango, jengibre y cúrcuma. Si colocas otro objeto, el sistema lo marca como NO RECONOCIDO y activa el servo de descarte.</p>
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
                <span>Aprobados</span>
                <strong>{dashboardStats.approved}</strong>
              </div>
              <div>
                <span>Rechazados</span>
                <strong>{dashboardStats.rejected}</strong>
              </div>
              <div>
                <span>Revisar</span>
                <strong>{dashboardStats.review}</strong>
              </div>
              <div>
                <span>No reconocidos</span>
                <strong>{dashboardStats.unknown}</strong>
              </div>
            </div>

            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Producto</th>
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
                      <td>{item.producto || item.fruta}</td>
                      <td>
                        <span className={`badge ${getBadgeClass(item.decision)}`}>
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
