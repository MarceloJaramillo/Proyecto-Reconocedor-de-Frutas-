import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Agro Quality AI - App.jsx FINAL
 *
 * Incluye:
 * - Login con Google/Firebase
 * - Administrador predeterminado del sistema
 * - Panel de usuarios: crear, editar rol, activar/desactivar y eliminar usuarios
 * - TensorFlow.js GraphModel
 * - Cámara en vivo
 * - Backend/API + ESP32
 *
 * Modelo esperado:
 * public/models/agro/model.json
 * public/models/agro/metadata.json
 * public/models/agro/group1-shard...
 */

const CONFIG = {
  API_URL: import.meta.env.VITE_API_URL || "http://localhost:4000",
  MODEL_URL: import.meta.env.VITE_AGRO_MODEL_URL || "/models/agro/model.json",
  METADATA_URL: import.meta.env.VITE_AGRO_METADATA_URL || "/models/agro/metadata.json",
  MIN_CONFIDENCE: Number(import.meta.env.VITE_MIN_MODEL_CONFIDENCE || 0.72),
  SERVO_DELAY_MS: Number(import.meta.env.VITE_DELAY_SERVO_MS || 4000),
  ANALYSIS_INTERVAL_MS: 800,
  SERVO_COOLDOWN_MS: 5000,
  SAVE_COOLDOWN_MS: 3500
};

/**
 * Administrador fijo/predeterminado.
 * No lo borres. Este perfil sirve para que siempre exista un admin del sistema.
 */
const DEFAULT_ADMIN = {
  id: "admin-principal",
  name: "Administrador Principal",
  email: "admin@smartvision.com",
  role: "Administrador",
  active: true,
  provider: "Sistema",
  protected: true,
  createdAt: "Inicial"
};

const DEMO_USER = {
  id: "usuario-demo",
  name: "Usuario Operador",
  email: "operador@smartvision.com",
  role: "Usuario",
  active: true,
  provider: "Sistema",
  protected: false,
  createdAt: "Inicial"
};

const DEFAULT_LABELS = [
  "curcuma_buena",
  "curcuma_mala",
  "jengibre_bueno",
  "jengibre_malo",
  "mango_bueno",
  "mango_malo",
  "no_reconocido",
  "palta_buena",
  "palta_mala"
];

const PRODUCTS = {
  palta: { name: "Palta", icon: "🥑" },
  mango: { name: "Mango", icon: "🥭" },
  jengibre: { name: "Jengibre", icon: "🫚" },
  curcuma: { name: "Cúrcuma", icon: "🟠" }
};

const EMPTY_RESULT = {
  decision: "ESPERANDO",
  status: "idle",
  product: "Sin producto",
  icon: "🌱",
  quality: 0,
  confidence: 0,
  damage: 0,
  label: "modelo pendiente",
  message: "Activa la cámara e inicia el filtro para analizar con la IA entrenada."
};

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowText() {
  return new Date().toLocaleString("es-PE");
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getProductFromLabel(label = "") {
  const clean = normalizeText(label);

  if (
    clean.includes("no_reconocido") ||
    clean.includes("no reconocido") ||
    clean.includes("unknown") ||
    clean.includes("otro")
  ) {
    return null;
  }

  if (clean.includes("palta") || clean.includes("avocado") || clean.includes("aguacate")) {
    return "palta";
  }

  if (clean.includes("mango")) return "mango";
  if (clean.includes("jengibre") || clean.includes("ginger")) return "jengibre";
  if (clean.includes("curcuma") || clean.includes("turmeric")) return "curcuma";

  return null;
}

function getConditionFromLabel(label = "") {
  const clean = normalizeText(label);

  if (
    clean.includes("_mala") ||
    clean.includes("_malo") ||
    clean.includes("mala") ||
    clean.includes("malo") ||
    clean.includes("mal_estado") ||
    clean.includes("podrida") ||
    clean.includes("podrido") ||
    clean.includes("danada") ||
    clean.includes("dañada") ||
    clean.includes("bad") ||
    clean.includes("rotten") ||
    clean.includes("mold")
  ) {
    return "bad";
  }

  if (
    clean.includes("_buena") ||
    clean.includes("_bueno") ||
    clean.includes("buena") ||
    clean.includes("bueno") ||
    clean.includes("buen_estado") ||
    clean.includes("sana") ||
    clean.includes("sano") ||
    clean.includes("good") ||
    clean.includes("fresh")
  ) {
    return "good";
  }

  return "review";
}

function buildDecision(topPrediction, secondPrediction) {
  const label = topPrediction?.label || "no_reconocido";
  const score = Number(topPrediction?.score || 0);
  const secondScore = Number(secondPrediction?.score || 0);
  const confidence = Math.round(score * 100);
  const margin = score - secondScore;

  const productKey = getProductFromLabel(label);
  const condition = getConditionFromLabel(label);

  if (!productKey || label === "no_reconocido" || score < CONFIG.MIN_CONFIDENCE || margin < 0.08) {
    return {
      decision: "NO_RECONOCIDO",
      status: "unknown",
      product: "Producto no reconocido",
      icon: "🚫",
      quality: 0,
      confidence,
      damage: 100,
      label,
      message:
        "El objeto no pertenece a palta, mango, jengibre o cúrcuma, o la IA no tiene confianza suficiente. Se enviará al descarte."
    };
  }

  const product = PRODUCTS[productKey];

  if (condition === "bad") {
    return {
      decision: "RECHAZADO",
      status: "bad",
      product: product.name,
      icon: product.icon,
      quality: Math.max(0, 100 - confidence),
      confidence,
      damage: Math.max(70, confidence),
      label,
      message:
        "El producto fue reconocido, pero está en mal estado. El sistema activará el servo de descarte."
    };
  }

  if (condition === "good") {
    return {
      decision: "APROBADO",
      status: "good",
      product: product.name,
      icon: product.icon,
      quality: Math.max(70, confidence),
      confidence,
      damage: Math.max(0, 100 - confidence),
      label,
      message:
        "El producto pertenece a la lista aceptada y fue clasificado en buen estado."
    };
  }

  return {
    decision: "REVISAR",
    status: "review",
    product: product.name,
    icon: product.icon,
    quality: 50,
    confidence,
    damage: 45,
    label,
    message:
      "El producto fue reconocido, pero la condición no es clara. Se recomienda revisión manual."
  };
}

function shouldReject(decision) {
  return decision === "RECHAZADO" || decision === "NO_RECONOCIDO";
}

async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    return {
      ok: response.ok,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

async function cloudRequest(endpoint, options = {}) {
  try {
    const isFormData = options.body instanceof FormData;

    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    return {
      ok: response.ok && data?.ok !== false,
      status: response.status,
      data,
      error: data?.error || data?.message || ""
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {},
      error: error.message
    };
  }
}

function normalizeUserItem(item = {}) {
  const email = normalizeEmail(item.email);
  return {
    ...item,
    id: item.id || email || makeId(),
    email,
    name: item.name || "Usuario",
    role: item.role === "Administrador" ? "Administrador" : "Usuario",
    active: item.protected ? true : Boolean(item.active),
    provider: item.provider || "Manual",
    protected: Boolean(item.protected)
  };
}

function normalizeProductItem(item = {}) {
  const productId = item.productId || item.id || item.slug || normalizeText(item.name || "");
  return {
    ...item,
    id: item.id || productId,
    productId,
    slug: item.slug || productId,
    name: item.name || productId || "Producto",
    icon: item.icon || "🌱",
    active: item.active ?? true,
    accepted: item.accepted ?? true,
    goodClass: item.goodClass || `${productId}_buena`,
    badClass: item.badClass || `${productId}_mala`,
    description: item.description || ""
  };
}

function normalizeImageItem(item = {}) {
  return {
    ...item,
    id: item.id || item.imageId || makeId(),
    imageId: item.imageId || item.id,
    productId: item.productId || "",
    productName: item.productName || item.productId || "Producto",
    className: item.className || "",
    url: item.url || "",
    filename: item.filename || item.originalName || "imagen",
    createdAt: item.createdAt || ""
  };
}

function normalizeHistoryItem(item = {}) {
  let date = item.date || item.createdAt || nowText();

  if (item.createdAt && !item.date) {
    try {
      date = new Date(item.createdAt).toLocaleString("es-PE");
    } catch {
      date = item.createdAt;
    }
  }

  return {
    ...item,
    id: item.id || item.scanId || makeId(),
    date,
    user: item.user || item.userEmail || "Sin usuario",
    product: item.product || "Sin producto",
    decision: item.decision || "REVISAR",
    quality: Number(item.quality || 0),
    confidence: Number(item.confidence || 0),
    label: item.label || ""
  };
}

function getHistoryFromStorage() {
  try {
    return JSON.parse(localStorage.getItem("agro_quality_history") || "[]");
  } catch {
    return [];
  }
}

function saveHistoryToStorage(items) {
  localStorage.setItem("agro_quality_history", JSON.stringify(items));
}

function getUsersFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem("agro_quality_users") || "[]");
    const normalized = Array.isArray(raw) ? raw : [];

    const hasAdmin = normalized.some(
      (item) => normalizeEmail(item.email) === normalizeEmail(DEFAULT_ADMIN.email)
    );

    const hasDemoUser = normalized.some(
      (item) => normalizeEmail(item.email) === normalizeEmail(DEMO_USER.email)
    );

    let users = normalized;

    if (!hasAdmin) users = [DEFAULT_ADMIN, ...users];
    if (!hasDemoUser) users = [...users, DEMO_USER];

    return users.map((item) => ({
      ...item,
      email: normalizeEmail(item.email),
      active: item.protected ? true : Boolean(item.active)
    }));
  } catch {
    return [DEFAULT_ADMIN, DEMO_USER];
  }
}

function saveUsersToStorage(users) {
  const withAdmin = users.some(
    (item) => normalizeEmail(item.email) === normalizeEmail(DEFAULT_ADMIN.email)
  )
    ? users
    : [DEFAULT_ADMIN, ...users];

  localStorage.setItem("agro_quality_users", JSON.stringify(withAdmin));
}

function getStatusClass(status) {
  if (status === "good") return "good";
  if (status === "bad") return "bad";
  if (status === "unknown") return "unknown";
  if (status === "review") return "review";
  return "idle";
}

function createCenterCrop(video) {
  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;

  const cropSize = Math.floor(Math.min(videoWidth, videoHeight) * 0.72);
  const cropX = Math.floor((videoWidth - cropSize) / 2);
  const cropY = Math.floor((videoHeight - cropSize) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = 224;
  canvas.height = 224;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, 224, 224);

  return {
    canvas,
    box: {
      x: cropX,
      y: cropY,
      size: cropSize,
      videoWidth,
      videoHeight
    }
  };
}

function disposeOutput(output) {
  if (!output) return;

  if (Array.isArray(output)) {
    output.forEach((item) => item?.dispose?.());
    return;
  }

  if (typeof output === "object" && !output.data && !output.dispose) {
    Object.values(output).forEach((item) => item?.dispose?.());
    return;
  }

  output?.dispose?.();
}

function pickTensorFromOutput(output) {
  if (!output) throw new Error("El modelo no devolvió salida.");

  if (Array.isArray(output)) {
    if (!output[0]) throw new Error("El modelo devolvió un array vacío.");
    return output[0];
  }

  if (output.data && output.shape) return output;

  if (typeof output === "object") {
    const values = Object.values(output);
    const tensor = values.find((item) => item?.data && item?.shape);
    if (tensor) return tensor;
  }

  throw new Error("No se encontró tensor de salida válido.");
}

async function runGraphPrediction(model, input, tf) {
  let output = null;

  try {
    output = model.execute(input);
  } catch (errorExecute) {
    console.warn("model.execute(input) falló:", errorExecute);

    try {
      output = model.predict(input);
    } catch (errorPredict) {
      console.warn("model.predict(input) falló:", errorPredict);

      const inputName =
        model.inputs?.[0]?.name ||
        model.inputNodes?.[0] ||
        model.executor?.graph?.inputs?.[0]?.name;

      if (!inputName) {
        throw new Error(
          `No se pudo identificar el nombre de entrada del GraphModel. execute: ${errorExecute.message}; predict: ${errorPredict.message}`
        );
      }

      const namedInput = {};
      namedInput[inputName] = input;

      try {
        output = model.execute(namedInput);
      } catch (errorNamed) {
        console.warn("model.execute(namedInput) falló:", errorNamed);
        output = await model.executeAsync(namedInput);
      }
    }
  }

  const tensor = pickTensorFromOutput(output);
  let values = Array.from(await tensor.data());

  const sum = values.reduce((acc, val) => acc + val, 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const looksLikeProbabilities = min >= 0 && max <= 1.0001 && sum > 0.98 && sum < 1.02;

  if (!looksLikeProbabilities) {
    const probsTensor = tf.tidy(() => tf.softmax(tf.tensor(values)));
    values = Array.from(await probsTensor.data());
    probsTensor.dispose();
  }

  disposeOutput(output);

  return values;
}

export default function App() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const modelRef = useRef(null);
  const tfRef = useRef(null);
  const labelsRef = useRef(DEFAULT_LABELS);
  const scannerTimerRef = useRef(null);
  const scannerActiveRef = useRef(false);
  const analyzingRef = useRef(false);
  const lastServoRef = useRef({ key: "", time: 0 });
  const lastSaveRef = useRef({ key: "", time: 0 });

  const [user, setUser] = useState(null);
  const [users, setUsers] = useState(getUsersFromStorage);
  const [products, setProducts] = useState([]);
  const [images, setImages] = useState([]);
  const [cloudMode, setCloudMode] = useState("verificando");
  const [view, setView] = useState("scanner");
  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelMessage, setModelMessage] = useState("Modelo no cargado");
  const [backendOk, setBackendOk] = useState(null);
  const [hardwareOk, setHardwareOk] = useState(null);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [history, setHistory] = useState(getHistoryFromStorage);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastRanking, setLastRanking] = useState([]);
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    role: "Usuario",
    active: true
  });
  const [selfRegisterForm, setSelfRegisterForm] = useState({
    name: "",
    email: ""
  });
  const [manualLoginEmail, setManualLoginEmail] = useState("");
  const [productForm, setProductForm] = useState({
    productId: "",
    name: "",
    icon: "🌱",
    goodClass: "",
    badClass: "",
    description: "",
    active: true,
    accepted: true
  });
  const [imageForm, setImageForm] = useState({
    productId: "palta",
    className: "palta_buena",
    file: null
  });

  const isAdmin = user?.role === "Administrador";

  const stats = useMemo(() => {
    return {
      total: history.length,
      approved: history.filter((item) => item.decision === "APROBADO").length,
      rejected: history.filter((item) => item.decision === "RECHAZADO").length,
      unknown: history.filter((item) => item.decision === "NO_RECONOCIDO").length,
      review: history.filter((item) => item.decision === "REVISAR").length,
      users: users.length,
      activeUsers: users.filter((item) => item.active).length,
      products: products.length,
      activeProducts: products.filter((item) => item.active).length,
      images: images.length
    };
  }, [history, users, products, images]);

  useEffect(() => {
    saveHistoryToStorage(history);
  }, [history]);

  useEffect(() => {
    saveUsersToStorage(users);
  }, [users]);

  useEffect(() => {
    checkBackend();
    loadCloudData(false);

    const interval = setInterval(() => {
      checkBackend();
    }, 10000);

    return () => {
      clearInterval(interval);
      stopCamera();
    };
  }, []);

  function setFlash(message, type = "success") {
    setError("");
    setSuccess("");

    if (type === "error") setError(message);
    else setSuccess(message);

    setTimeout(() => {
      setError("");
      setSuccess("");
    }, 5000);
  }

  async function fetchCloudUsers() {
    const response = await cloudRequest("/api/cloud/users");

    if (!response.ok) {
      throw new Error(response.error || "No se pudieron cargar usuarios desde AWS.");
    }

    return (response.data.users || []).map(normalizeUserItem);
  }

  async function fetchCloudProducts() {
    const response = await cloudRequest("/api/cloud/products");

    if (!response.ok) {
      throw new Error(response.error || "No se pudieron cargar productos desde AWS.");
    }

    return (response.data.products || []).map(normalizeProductItem);
  }

  async function fetchCloudImages() {
    const response = await cloudRequest("/api/cloud/images");

    if (!response.ok) {
      throw new Error(response.error || "No se pudieron cargar imágenes desde AWS.");
    }

    return (response.data.images || []).map(normalizeImageItem);
  }

  async function fetchCloudHistory() {
    const response = await cloudRequest("/api/cloud/scan-history");

    if (!response.ok) {
      throw new Error(response.error || "No se pudo cargar historial desde AWS.");
    }

    return (response.data.scanHistory || []).map(normalizeHistoryItem);
  }

  async function loadCloudData(showMessage = false) {
    try {
      const [cloudUsers, cloudProducts, cloudImages, cloudHistory] = await Promise.all([
        fetchCloudUsers(),
        fetchCloudProducts(),
        fetchCloudImages(),
        fetchCloudHistory()
      ]);

      setUsers(cloudUsers);
      setProducts(cloudProducts);
      setImages(cloudImages);
      setHistory(cloudHistory);
      setCloudMode("dynamodb-s3");

      if (showMessage) {
        setFlash("Datos sincronizados con AWS correctamente.");
      }
    } catch (err) {
      console.error(err);
      setCloudMode("local/fallback");
      if (showMessage) {
        setFlash(`No se pudo sincronizar con AWS: ${err.message || err}`, "error");
      }
    }
  }

  async function loginWithGoogle() {
    setError("");
    setSuccess("");

    try {
      const firebase = await import("./firebase");
      const result = await firebase.signInWithPopup(firebase.auth, firebase.googleProvider);
      const firebaseUser = result.user;

      const email = normalizeEmail(firebaseUser.email);
      let cloudUsers = users;

      try {
        cloudUsers = await fetchCloudUsers();
        setUsers(cloudUsers);
      } catch {
        // si AWS no responde, usamos el estado actual
      }

      const existing = cloudUsers.find((item) => normalizeEmail(item.email) === email);

      if (!existing) {
        const pendingUser = {
          name: firebaseUser.displayName || "Usuario Google",
          email,
          role: "Usuario",
          active: false,
          provider: "Google",
          protected: false,
          photoURL: firebaseUser.photoURL || ""
        };

        const created = await cloudRequest("/api/cloud/users", {
          method: "POST",
          body: JSON.stringify(pendingUser)
        });

        if (!created.ok) {
          throw new Error(created.error || "No se pudo registrar tu usuario en AWS.");
        }

        await loadCloudData(false);

        try {
          await firebase.signOut(firebase.auth);
        } catch {
          // no pasa nada
        }

        setFlash(
          "Tu cuenta Google fue registrada en AWS, pero aún está pendiente. El administrador debe activarla.",
          "error"
        );
        return;
      }

      if (!existing.active) {
        try {
          await firebase.signOut(firebase.auth);
        } catch {
          // no pasa nada
        }

        setFlash("Tu usuario está desactivado. Contacta al administrador.", "error");
        return;
      }

      setUser({
        ...existing,
        name: firebaseUser.displayName || existing.name,
        photoURL: firebaseUser.photoURL || existing.photoURL || ""
      });
      setFlash(`Bienvenido, ${existing.name}.`);
    } catch (err) {
      console.error(err);
      setFlash(
        "No se pudo iniciar sesión con Google. Revisa tu archivo src/firebase.js y tus variables Firebase en .env.local.",
        "error"
      );
    }
  }

  function loginAsDefaultAdmin() {
    const admin = users.find(
      (item) => normalizeEmail(item.email) === normalizeEmail(DEFAULT_ADMIN.email)
    );

    setUser(admin || DEFAULT_ADMIN);
    setFlash("Entraste como Administrador Principal.");
  }

  function loginAsDemoUser() {
    const demo = users.find(
      (item) => normalizeEmail(item.email) === normalizeEmail(DEMO_USER.email)
    );

    if (!demo?.active) {
      setFlash("El usuario demo está desactivado. Actívalo desde el administrador.", "error");
      return;
    }

    setUser(demo || DEMO_USER);
    setFlash("Entraste como Usuario Demo.");
  }

  async function loginWithRegisteredEmail(event) {
    event.preventDefault();

    const email = normalizeEmail(manualLoginEmail);

    if (!email) {
      setFlash("Escribe tu correo registrado.", "error");
      return;
    }

    try {
      const cloudUsers = await fetchCloudUsers();
      setUsers(cloudUsers);

      const existing = cloudUsers.find((item) => normalizeEmail(item.email) === email);

      if (!existing) {
        setFlash("Este correo todavía no está registrado. Primero crea tu usuario.", "error");
        return;
      }

      if (!existing.active) {
        setFlash("Tu usuario existe, pero aún está pendiente de activación por el administrador.", "error");
        return;
      }

      setUser(existing);
      setManualLoginEmail("");
      setFlash(`Bienvenido, ${existing.name}.`);
    } catch (err) {
      console.error(err);
      setFlash(`No se pudo iniciar sesión: ${err.message || err}`, "error");
    }
  }

  async function registerOwnUser(event) {
    event.preventDefault();

    const name = selfRegisterForm.name.trim();
    const email = normalizeEmail(selfRegisterForm.email);

    if (!name || !email) {
      setFlash("Completa tu nombre y correo para crear tu usuario.", "error");
      return;
    }

    try {
      const cloudUsers = await fetchCloudUsers();
      const existing = cloudUsers.find((item) => normalizeEmail(item.email) === email);

      if (existing?.active) {
        setFlash("Este usuario ya existe y está activo. Puedes pedir acceso al administrador.", "error");
        return;
      }

      if (existing && !existing.active) {
        setFlash("Tu usuario ya está registrado, pero falta que el administrador lo active.", "error");
        return;
      }

      const created = await cloudRequest("/api/cloud/users", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          role: "Usuario",
          active: false,
          provider: "Registro Web"
        })
      });

      if (!created.ok) {
        throw new Error(created.error || "No se pudo crear tu usuario.");
      }

      setSelfRegisterForm({ name: "", email: "" });
      await loadCloudData(false);

      setFlash(
        "Usuario creado correctamente en AWS. Ahora el administrador debe activarlo para que puedas ingresar.",
        "success"
      );
    } catch (err) {
      console.error(err);
      setFlash(`No se pudo crear el usuario: ${err.message || err}`, "error");
    }
  }

  async function logoutUser() {
    stopCamera();

    try {
      const firebase = await import("./firebase");
      await firebase.signOut(firebase.auth);
    } catch {
      // si no hay Firebase, igual cerramos sesión local
    }

    setUser(null);
    setView("scanner");
    setResult(EMPTY_RESULT);
  }

  async function addOrUpdateUser(event) {
    event.preventDefault();

    if (!isAdmin) {
      setFlash("Solo el administrador puede gestionar usuarios.", "error");
      return;
    }

    const email = normalizeEmail(userForm.email);
    const name = userForm.name.trim();

    if (!email || !name) {
      setFlash("Completa nombre y correo.", "error");
      return;
    }

    try {
      const exists = users.find((item) => normalizeEmail(item.email) === email);

      if (exists) {
        const updated = await cloudRequest(`/api/cloud/users/${encodeURIComponent(email)}`, {
          method: "PUT",
          body: JSON.stringify({
            name,
            email,
            role: userForm.role,
            active: Boolean(userForm.active)
          })
        });

        if (!updated.ok) {
          throw new Error(updated.error || "No se pudo actualizar el usuario en AWS.");
        }

        setFlash("Usuario actualizado correctamente en AWS.");
      } else {
        const created = await cloudRequest("/api/cloud/users", {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            role: userForm.role,
            active: Boolean(userForm.active),
            provider: "Manual"
          })
        });

        if (!created.ok) {
          throw new Error(created.error || "No se pudo crear el usuario en AWS.");
        }

        setFlash("Usuario creado correctamente en AWS.");
      }

      setUserForm({
        name: "",
        email: "",
        role: "Usuario",
        active: true
      });

      await loadCloudData(false);
    } catch (err) {
      console.error(err);
      setFlash(`Error guardando usuario: ${err.message || err}`, "error");
    }
  }

  function editUser(item) {
    setUserForm({
      name: item.name,
      email: item.email,
      role: item.role,
      active: Boolean(item.active)
    });
    setView("users");
  }

  async function toggleUserActive(item) {
    if (!isAdmin) return;

    if (item.protected) {
      setFlash("El administrador principal no se puede desactivar.", "error");
      return;
    }

    try {
      const response = await cloudRequest(`/api/cloud/users/${encodeURIComponent(item.email)}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active: !item.active })
      });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo cambiar el estado del usuario.");
      }

      await loadCloudData(false);
      setFlash(item.active ? "Usuario desactivado en AWS." : "Usuario activado en AWS.");
    } catch (err) {
      console.error(err);
      setFlash(`Error actualizando estado: ${err.message || err}`, "error");
    }
  }

  async function changeUserRole(item, role) {
    if (!isAdmin) return;

    if (item.protected) {
      setFlash("El administrador principal siempre mantiene rol Administrador.", "error");
      return;
    }

    try {
      const response = await cloudRequest(`/api/cloud/users/${encodeURIComponent(item.email)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...item,
          role
        })
      });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo actualizar el rol.");
      }

      await loadCloudData(false);
      setFlash("Rol actualizado en AWS.");
    } catch (err) {
      console.error(err);
      setFlash(`Error actualizando rol: ${err.message || err}`, "error");
    }
  }

  async function deleteUser(item) {
    if (!isAdmin) return;

    if (item.protected) {
      setFlash("El administrador principal no se puede eliminar.", "error");
      return;
    }

    const confirmDelete = window.confirm(`¿Eliminar usuario ${item.email}?`);

    if (!confirmDelete) return;

    try {
      const response = await cloudRequest(`/api/cloud/users/${encodeURIComponent(item.email)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo eliminar el usuario.");
      }

      await loadCloudData(false);
      setFlash("Usuario eliminado de AWS.");
    } catch (err) {
      console.error(err);
      setFlash(`Error eliminando usuario: ${err.message || err}`, "error");
    }
  }

  async function checkBackend() {
    const health = await cloudRequest("/api/cloud/health");
    setBackendOk(health.ok);

    if (health.ok) {
      setCloudMode(health.data?.mode || "aws");
    }

    const status = await cloudRequest("/api/hardware/status");
    setHardwareOk(status.ok);
  }

  async function loadModel() {
    if (modelRef.current && tfRef.current) {
      return {
        model: modelRef.current,
        tf: tfRef.current
      };
    }

    setError("");
    setModelMessage("Cargando TensorFlow.js...");

    try {
      const tf = await import("@tensorflow/tfjs");
      tfRef.current = tf;

      await tf.ready();

      setModelMessage("Cargando GraphModel entrenado...");

      const model = await tf.loadGraphModel(CONFIG.MODEL_URL);
      modelRef.current = model;

      console.log("GraphModel cargado:", model);
      console.log("Inputs:", model.inputs);
      console.log("Outputs:", model.outputs);

      try {
        const response = await fetch(CONFIG.METADATA_URL);
        if (response.ok) {
          const metadata = await response.json();
          labelsRef.current = metadata.labels || metadata.classes || DEFAULT_LABELS;
        } else {
          labelsRef.current = DEFAULT_LABELS;
        }
      } catch {
        labelsRef.current = DEFAULT_LABELS;
      }

      setModelReady(true);
      setModelMessage("Modelo IA GraphModel listo");

      return { model, tf };
    } catch (err) {
      console.error("Error cargando GraphModel:", err);
      setModelReady(false);
      setModelMessage("Error cargando modelo");
      setError(`No se pudo cargar el GraphModel con TensorFlow.js. Detalle: ${err.message || err}`);
      throw err;
    }
  }

  async function startCamera() {
    setError("");

    try {
      await loadModel();

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
        decision: "LISTO",
        label: "GraphModel cargado",
        message: "Cámara activa. Coloca el producto en el centro e inicia el filtro."
      });
    } catch (err) {
      console.error(err);
      setError("No se pudo activar la cámara. Revisa permisos de cámara y modelo IA.");
    }
  }

  function stopCamera() {
    stopScan();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    clearOverlay();
    setCameraOn(false);
  }

  function startScan() {
    setError("");

    scannerActiveRef.current = true;
    setScanning(true);
    setResult({
      ...EMPTY_RESULT,
      decision: "ESCANEANDO",
      label: "analizando",
      message: "La IA está analizando el producto en tiempo real."
    });

    if (!cameraOn) {
      startCamera().then(() => {
        scannerActiveRef.current = true;
        setScanning(true);
        analyzeLoop();
      });
      return;
    }

    analyzeLoop();
  }

  function stopScan() {
    scannerActiveRef.current = false;
    setScanning(false);

    if (scannerTimerRef.current) {
      clearTimeout(scannerTimerRef.current);
      scannerTimerRef.current = null;
    }
  }

  async function analyzeLoop() {
    if (!scannerActiveRef.current || analyzingRef.current) return;

    analyzingRef.current = true;

    try {
      const video = videoRef.current;

      if (!video || video.readyState < 2 || !cameraOn) {
        scheduleNextAnalysis();
        return;
      }

      const { model, tf } = await loadModel();
      const { canvas, box } = createCenterCrop(video);

      const input = tf.tidy(() => {
        return tf.browser
          .fromPixels(canvas)
          .resizeBilinear([224, 224])
          .expandDims(0)
          .toFloat();
      });

      const values = await runGraphPrediction(model, input, tf);
      input.dispose();

      const ranking = values
        .map((score, index) => ({
          label: labelsRef.current[index] || `clase_${index}`,
          score: Number(score)
        }))
        .sort((a, b) => b.score - a.score);

      setLastRanking(ranking.slice(0, 5));

      const nextResult = buildDecision(ranking[0], ranking[1]);
      setResult(nextResult);
      drawOverlay(box, nextResult);

      saveResult(nextResult);

      if (shouldReject(nextResult.decision)) {
        triggerServoWithCooldown(nextResult);
      }
    } catch (err) {
      console.error("Error analizando frame:", err);
      setError(`Error analizando con GraphModel. Detalle: ${err.message || err}`);
    } finally {
      analyzingRef.current = false;
      scheduleNextAnalysis();
    }
  }

  function scheduleNextAnalysis() {
    if (!scannerActiveRef.current) return;

    scannerTimerRef.current = setTimeout(() => {
      analyzeLoop();
    }, CONFIG.ANALYSIS_INTERVAL_MS);
  }

  function drawOverlay(box, nextResult) {
    const canvas = overlayRef.current;
    if (!canvas) return;

    canvas.width = box.videoWidth;
    canvas.height = box.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, box.videoWidth, box.videoHeight);

    const color =
      nextResult.decision === "APROBADO"
        ? "#22c55e"
        : nextResult.decision === "REVISAR"
          ? "#f59e0b"
          : "#ef4444";

    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.shadowBlur = 12;
    ctx.shadowColor = color;
    ctx.strokeRect(box.x, box.y, box.size, box.size);

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(2, 22, 18, 0.92)";
    ctx.fillRect(box.x, Math.max(0, box.y - 46), Math.min(box.size, 560), 40);

    ctx.fillStyle = color;
    ctx.font = "bold 22px Arial";
    ctx.fillText(
      `${nextResult.product} · ${nextResult.decision}`,
      box.x + 12,
      Math.max(30, box.y - 18)
    );
  }

  function clearOverlay() {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function triggerServoWithCooldown(nextResult) {
    const key = `${nextResult.decision}-${nextResult.product}-${nextResult.label}`;
    const now = Date.now();

    if (lastServoRef.current.key === key && now - lastServoRef.current.time < CONFIG.SERVO_COOLDOWN_MS) {
      return;
    }

    lastServoRef.current = { key, time: now };

    await apiRequest("/api/hardware/desviar", {
      method: "POST",
      body: JSON.stringify({
        immediate: false,
        delayMs: CONFIG.SERVO_DELAY_MS,
        reason:
          nextResult.decision === "RECHAZADO"
            ? "producto_mal_estado"
            : "producto_no_reconocido",
        product: nextResult.product,
        quality: nextResult.quality,
        confidence: nextResult.confidence
      })
    });
  }

  async function saveResult(nextResult) {
    if (!["APROBADO", "RECHAZADO", "NO_RECONOCIDO", "REVISAR"].includes(nextResult.decision)) {
      return;
    }

    const key = `${nextResult.decision}-${nextResult.product}-${nextResult.label}`;
    const now = Date.now();

    if (lastSaveRef.current.key === key && now - lastSaveRef.current.time < CONFIG.SAVE_COOLDOWN_MS) {
      return;
    }

    lastSaveRef.current = { key, time: now };

    const item = {
      id: makeId(),
      date: nowText(),
      user: user?.name || "Sin usuario",
      userEmail: user?.email || "local",
      product: nextResult.product,
      decision: nextResult.decision,
      quality: nextResult.quality,
      confidence: nextResult.confidence,
      label: nextResult.label
    };

    setHistory((current) => [item, ...current].slice(0, 80));

    cloudRequest("/api/cloud/scan-history", {
      method: "POST",
      body: JSON.stringify({
        product: nextResult.product,
        decision: nextResult.decision,
        quality: nextResult.quality,
        damage: nextResult.damage,
        confidence: nextResult.confidence,
        label: nextResult.label,
        userEmail: user?.email || "local",
        source: "frontend-tfjs-graphmodel"
      })
    });
  }

  async function turnBeltOn() {
    await apiRequest("/api/hardware/banda/on", {
      method: "POST",
      body: JSON.stringify({ requestedBy: user?.email || "frontend" })
    });
    checkBackend();
  }

  async function turnBeltOff() {
    await apiRequest("/api/hardware/banda/off", {
      method: "POST",
      body: JSON.stringify({ requestedBy: user?.email || "frontend" })
    });
    checkBackend();
  }

  async function testServo() {
    await apiRequest("/api/hardware/desviar", {
      method: "POST",
      body: JSON.stringify({
        immediate: true,
        delayMs: 0,
        reason: "prueba_manual",
        product: "manual"
      })
    });
    checkBackend();
  }

  async function testModelPath() {
    setError("");

    try {
      const response = await fetch(CONFIG.MODEL_URL);
      if (!response.ok) {
        setError(`No se encontró el modelo en ${CONFIG.MODEL_URL}. Status: ${response.status}`);
        return;
      }

      await loadModel();
      setError("");
      setResult({
        ...EMPTY_RESULT,
        decision: "MODELO_OK",
        label: "GraphModel probado",
        message: "El modelo GraphModel se encontró y cargó correctamente con TensorFlow.js."
      });
    } catch (err) {
      console.error(err);
      setError(`El modelo existe, pero no pudo cargarse con TensorFlow.js. Detalle: ${err.message || err}`);
    }
  }

  async function clearHistory() {
    setHistory([]);
    localStorage.removeItem("agro_quality_history");

    const response = await cloudRequest("/api/cloud/scan-history", {
      method: "DELETE"
    });

    if (response.ok) {
      setFlash("Historial eliminado de AWS.");
    } else {
      setFlash("Se limpió el historial local, pero no se pudo limpiar AWS.", "error");
    }
  }

  async function addOrUpdateProduct(event) {
    event.preventDefault();

    if (!isAdmin) {
      setFlash("Solo el administrador puede gestionar frutas/productos.", "error");
      return;
    }

    const name = productForm.name.trim();
    const productId = normalizeText(productForm.productId || name).replace(/\s+/g, "_");

    if (!name || !productId) {
      setFlash("Completa el nombre del producto.", "error");
      return;
    }

    try {
      const exists = products.find((item) => item.productId === productId || item.id === productId);
      const payload = {
        productId,
        name,
        icon: productForm.icon || "🌱",
        goodClass: productForm.goodClass || `${productId}_buena`,
        badClass: productForm.badClass || `${productId}_mala`,
        description: productForm.description || "",
        active: Boolean(productForm.active),
        accepted: Boolean(productForm.accepted)
      };

      const response = exists
        ? await cloudRequest(`/api/cloud/products/${encodeURIComponent(productId)}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          })
        : await cloudRequest("/api/cloud/products", {
            method: "POST",
            body: JSON.stringify(payload)
          });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo guardar el producto.");
      }

      setProductForm({
        productId: "",
        name: "",
        icon: "🌱",
        goodClass: "",
        badClass: "",
        description: "",
        active: true,
        accepted: true
      });

      await loadCloudData(false);
      setFlash(exists ? "Producto actualizado en AWS." : "Producto creado en AWS.");
    } catch (err) {
      console.error(err);
      setFlash(`Error guardando producto: ${err.message || err}`, "error");
    }
  }

  function editProduct(item) {
    setProductForm({
      productId: item.productId || item.id,
      name: item.name || "",
      icon: item.icon || "🌱",
      goodClass: item.goodClass || "",
      badClass: item.badClass || "",
      description: item.description || "",
      active: item.active ?? true,
      accepted: item.accepted ?? true
    });
    setView("products");
  }

  async function deleteProduct(item) {
    if (!isAdmin) return;

    const productId = item.productId || item.id;
    const confirmDelete = window.confirm(`¿Eliminar producto ${item.name}?`);

    if (!confirmDelete) return;

    try {
      const response = await cloudRequest(`/api/cloud/products/${encodeURIComponent(productId)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo eliminar el producto.");
      }

      await loadCloudData(false);
      setFlash("Producto eliminado de AWS.");
    } catch (err) {
      console.error(err);
      setFlash(`Error eliminando producto: ${err.message || err}`, "error");
    }
  }

  async function uploadDatasetImage(event) {
    event.preventDefault();

    if (!isAdmin) {
      setFlash("Solo el administrador puede subir imágenes.", "error");
      return;
    }

    if (!imageForm.productId || !imageForm.className || !imageForm.file) {
      setFlash("Selecciona producto, clase e imagen.", "error");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("productId", imageForm.productId);
      formData.append("className", imageForm.className);
      formData.append("image", imageForm.file);

      const response = await cloudRequest("/api/cloud/images", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo subir la imagen.");
      }

      setImageForm((current) => ({ ...current, file: null }));
      const fileInput = document.getElementById("datasetImageFile");
      if (fileInput) fileInput.value = "";

      await loadCloudData(false);
      setFlash("Imagen subida correctamente a S3 y registrada en DynamoDB.");
    } catch (err) {
      console.error(err);
      setFlash(`Error subiendo imagen: ${err.message || err}`, "error");
    }
  }

  async function deleteDatasetImage(item) {
    if (!isAdmin) return;

    const confirmDelete = window.confirm(`¿Eliminar imagen ${item.filename || item.originalName}?`);

    if (!confirmDelete) return;

    try {
      const response = await cloudRequest(`/api/cloud/images/${encodeURIComponent(item.imageId || item.id)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(response.error || "No se pudo eliminar la imagen.");
      }

      await loadCloudData(false);
      setFlash("Imagen eliminada de S3 y DynamoDB.");
    } catch (err) {
      console.error(err);
      setFlash(`Error eliminando imagen: ${err.message || err}`, "error");
    }
  }

  const selectedImageProduct = products.find(
    (item) => (item.productId || item.id) === imageForm.productId
  );

  if (!user) {
    return (
      <>
        <AppStyles />
        <main className="loginPage">
          <section className="loginCard">
            <div className="loginHero">
              <div className="logoBig">🥑</div>
              <span className="badge">Cognitive Computing</span>
              <h1>Agro Quality AI</h1>
              <p>
                Sistema inteligente con Google Login, administrador de usuarios,
                TensorFlow.js GraphModel, Backend/API y ESP32.
              </p>
            </div>

            <div className="loginPanel">
              <h2>Acceso al sistema</h2>
              <p>
                El administrador principal se mantiene fijo y puede crear, editar,
                activar o desactivar usuarios.
              </p>

              <button className="btn google" onClick={loginWithGoogle}>
                Ingresar con Google / Gmail
              </button>

              <form className="manualLoginBox" onSubmit={loginWithRegisteredEmail}>
                <input
                  value={manualLoginEmail}
                  onChange={(event) => setManualLoginEmail(event.target.value)}
                  placeholder="correo registrado"
                />
                <button className="btn primary" type="submit">
                  Ingresar con correo registrado
                </button>
              </form>

              <button className="btn primary" onClick={loginAsDefaultAdmin}>
                Ingresar como Administrador Principal
              </button>

              <button className="btn secondary" onClick={loginAsDemoUser}>
                Ingresar como Usuario Demo
              </button>

              <button className="btn ghost" onClick={testModelPath}>
                Probar carga del modelo
              </button>

              <form className="selfRegisterBox" onSubmit={registerOwnUser}>
                <h3>Crear mi usuario</h3>
                <p>Tu usuario quedará pendiente hasta que el administrador lo active.</p>

                <input
                  value={selfRegisterForm.name}
                  onChange={(event) =>
                    setSelfRegisterForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Tu nombre"
                />

                <input
                  value={selfRegisterForm.email}
                  onChange={(event) =>
                    setSelfRegisterForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="tu_correo@gmail.com"
                />

                <button className="btn secondary" type="submit">
                  Crear usuario pendiente
                </button>
              </form>

              <div className="miniInfo">
                <strong>Administrador:</strong> {DEFAULT_ADMIN.email}
                <br />
                <strong>Modelo TFJS:</strong> {CONFIG.MODEL_URL}
              </div>

              {error && <div className="alert">{error}</div>}
              {success && <div className="success">{success}</div>}
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <AppStyles />
      <main className="appPage">
        <aside className="sidebar">
          <div className="brand">
            <div className="logoSmall">🥑</div>
            <div>
              <strong>Agro Quality AI</strong>
              <span>{user.role}</span>
            </div>
          </div>

          <nav className="nav">
            <button className={view === "scanner" ? "active" : ""} onClick={() => setView("scanner")}>
              📷 Verificar producto
            </button>
            <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
              📋 Historial
            </button>
            {isAdmin && (
              <>
                <button className={view === "users" ? "active" : ""} onClick={() => setView("users")}>
                  👥 Usuarios
                </button>
                <button className={view === "products" ? "active" : ""} onClick={() => setView("products")}>
                  🥭 Frutas / Productos
                </button>
                <button className={view === "images" ? "active" : ""} onClick={() => setView("images")}>
                  🖼️ Imágenes
                </button>
              </>
            )}
            <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
              ⚙️ Diagnóstico
            </button>
          </nav>

          <div className="sideStatus">
            <span className={modelReady ? "dot ok" : "dot"} />
            <div>
              <strong>TensorFlow.js</strong>
              <small>{modelMessage}</small>
            </div>
          </div>

          <div className="sideStatus">
            <span className={backendOk ? "dot ok" : "dot bad"} />
            <div>
              <strong>Backend</strong>
              <small>{backendOk === null ? "verificando" : backendOk ? "conectado" : "sin conexión"}</small>
            </div>
          </div>

          <div className="sideStatus">
            <span className={hardwareOk ? "dot ok" : "dot bad"} />
            <div>
              <strong>ESP32</strong>
              <small>{hardwareOk === null ? "verificando" : hardwareOk ? "responde" : "sin respuesta"}</small>
            </div>
          </div>

          <div className="userCard">
            <span>Sesión activa</span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>

          <button className="logout" onClick={logoutUser}>
            Cerrar sesión
          </button>
        </aside>

        <section className="content">
          <header className="header">
            <div>
              <span className="badge">Filtro inteligente</span>
              <h1>
                {view === "scanner" && "Verificar producto agrícola"}
                {view === "history" && "Historial de verificaciones"}
                {view === "users" && "Administración de usuarios"}
                {view === "products" && "Frutas y productos"}
                {view === "images" && "Imágenes del dataset"}
                {view === "settings" && "Diagnóstico del sistema"}
              </h1>
            </div>

            <div className="headerActions">
              <button className="smallBtn" onClick={() => loadCloudData(true)}>Sincronizar AWS</button>
              <button className="smallBtn" onClick={checkBackend}>Actualizar estado</button>
              <button className="smallBtn" onClick={testModelPath}>Probar modelo</button>
            </div>
          </header>

          {error && <div className="alert topAlert">{error}</div>}
          {success && <div className="success topAlert">{success}</div>}

          {view === "scanner" && (
            <section className="scannerGrid">
              <div className="cameraCard">
                <div className="cameraBox">
                  <video ref={videoRef} muted playsInline />
                  <canvas ref={overlayRef} />
                  {!cameraOn && (
                    <div className="cameraPlaceholder">
                      <strong>📷 Cámara apagada</strong>
                      <span>Coloca el producto en el centro cuando la actives.</span>
                    </div>
                  )}
                </div>

                <div className="controls">
                  <button className="blue" onClick={startCamera}>Activar cámara</button>
                  <button className="green" onClick={startScan} disabled={scanning}>
                    Iniciar filtro
                  </button>
                  <button className="yellow" onClick={stopScan}>Detener filtro</button>
                  <button className="red" onClick={stopCamera}>Apagar cámara</button>
                </div>

                <div className="hardwareControls">
                  <span>Control ESP32:</span>
                  <button onClick={turnBeltOn}>▶️ Encender banda</button>
                  <button onClick={turnBeltOff}>⏹️ Apagar banda</button>
                  <button onClick={testServo}>🧪 Probar servo</button>
                </div>
              </div>

              <aside className={`resultCard ${getStatusClass(result.status)}`}>
                <div className="resultHead">
                  <div className="resultIcon">{result.icon}</div>
                  <div>
                    <span>Resultado del filtro</span>
                    <h2>{result.decision}</h2>
                  </div>
                </div>

                <div className="productBox">
                  <span className="labelChip">{result.label}</span>
                  <h3>{result.product}</h3>
                  <p>{result.message}</p>
                </div>

                <div className="metric">
                  <div>
                    <span>Calidad estimada</span>
                    <strong>{result.quality}%</strong>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${result.quality}%` }} />
                  </div>
                </div>

                <div className="metricGrid">
                  <div>
                    <span>Confianza IA</span>
                    <strong>{result.confidence}%</strong>
                  </div>
                  <div>
                    <span>Daño visual</span>
                    <strong>{result.damage}%</strong>
                  </div>
                </div>

                <div className="rankingBox">
                  <strong>Top predicciones</strong>
                  {lastRanking.length === 0 ? (
                    <p>Aún no hay predicciones.</p>
                  ) : (
                    lastRanking.map((item) => (
                      <div className="rankItem" key={item.label}>
                        <span>{item.label}</span>
                        <b>{Math.round(item.score * 100)}%</b>
                      </div>
                    ))
                  )}
                </div>

                <div className="support">
                  <strong>Productos aceptados</strong>
                  <p>Palta, mango, jengibre y cúrcuma. Otro objeto debe salir como NO_RECONOCIDO.</p>
                </div>
              </aside>
            </section>
          )}

          {view === "history" && (
            <section>
              <div className="stats">
                <div><span>Total</span><strong>{stats.total}</strong></div>
                <div><span>Aprobados</span><strong>{stats.approved}</strong></div>
                <div><span>Rechazados</span><strong>{stats.rejected}</strong></div>
                <div><span>No reconocidos</span><strong>{stats.unknown}</strong></div>
                <div><span>Revisar</span><strong>{stats.review}</strong></div>
              </div>

              <div className="tableHeader">
                <h2>Registros recientes</h2>
                <button className="smallBtn danger" onClick={clearHistory}>Limpiar historial local</button>
              </div>

              <div className="tableCard">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Usuario</th>
                      <th>Producto</th>
                      <th>Resultado</th>
                      <th>Calidad</th>
                      <th>Confianza</th>
                      <th>Clase IA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 && (
                      <tr>
                        <td colSpan="7">Aún no hay verificaciones.</td>
                      </tr>
                    )}

                    {history.map((item) => (
                      <tr key={item.id}>
                        <td>{item.date}</td>
                        <td>{item.user}</td>
                        <td>{item.product}</td>
                        <td>{item.decision}</td>
                        <td>{item.quality}%</td>
                        <td>{item.confidence}%</td>
                        <td>{item.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {view === "users" && isAdmin && (
            <section className="usersGrid">
              <div className="userFormCard">
                <h2>Crear / editar usuario</h2>
                <p>
                  Los usuarios de Google que no existan se registran como inactivos.
                  El administrador debe activarlos.
                </p>

                <form onSubmit={addOrUpdateUser}>
                  <label>
                    Nombre
                    <input
                      value={userForm.name}
                      onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Nombre del usuario"
                    />
                  </label>

                  <label>
                    Correo
                    <input
                      value={userForm.email}
                      onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="correo@gmail.com"
                    />
                  </label>

                  <label>
                    Rol
                    <select
                      value={userForm.role}
                      onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
                    >
                      <option value="Usuario">Usuario</option>
                      <option value="Administrador">Administrador</option>
                    </select>
                  </label>

                  <label className="checkLine">
                    <input
                      type="checkbox"
                      checked={userForm.active}
                      onChange={(event) => setUserForm((current) => ({ ...current, active: event.target.checked }))}
                    />
                    Usuario activo
                  </label>

                  <button className="btn primary" type="submit">
                    Guardar usuario
                  </button>
                </form>
              </div>

              <div className="usersListCard">
                <div className="tableHeader">
                  <h2>Usuarios registrados</h2>
                  <div className="miniStats">
                    {stats.activeUsers}/{stats.users} activos
                  </div>
                </div>

                <div className="tableCard">
                  <table>
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Correo</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Proveedor</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.name}</strong>
                            {item.protected && <span className="protectedTag">Principal</span>}
                          </td>
                          <td>{item.email}</td>
                          <td>
                            <select
                              className="tableSelect"
                              value={item.role}
                              disabled={item.protected}
                              onChange={(event) => changeUserRole(item, event.target.value)}
                            >
                              <option value="Usuario">Usuario</option>
                              <option value="Administrador">Administrador</option>
                            </select>
                          </td>
                          <td>
                            <span className={item.active ? "state active" : "state inactive"}>
                              {item.active ? "Activo" : "Inactivo"}
                            </span>
                          </td>
                          <td>{item.provider || "Manual"}</td>
                          <td>
                            <div className="rowActions">
                              <button className="smallBtn" onClick={() => editUser(item)}>
                                Editar
                              </button>
                              <button className="smallBtn" onClick={() => toggleUserActive(item)}>
                                {item.active ? "Desactivar" : "Activar"}
                              </button>
                              <button className="smallBtn danger" onClick={() => deleteUser(item)}>
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {view === "products" && isAdmin && (
            <section className="usersGrid">
              <div className="userFormCard">
                <h2>Crear / editar fruta</h2>
                <p>
                  Las frutas se guardan en DynamoDB. Crear una fruta no reentrena automáticamente la IA,
                  pero sí deja el producto listo para organizar imágenes del dataset.
                </p>

                <form onSubmit={addOrUpdateProduct}>
                  <label>
                    ID producto
                    <input
                      value={productForm.productId}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, productId: event.target.value }))
                      }
                      placeholder="ejemplo: naranja"
                    />
                  </label>

                  <label>
                    Nombre
                    <input
                      value={productForm.name}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Nombre del producto"
                    />
                  </label>

                  <label>
                    Icono
                    <input
                      value={productForm.icon}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, icon: event.target.value }))
                      }
                      placeholder="🥭"
                    />
                  </label>

                  <label>
                    Clase buena
                    <input
                      value={productForm.goodClass}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, goodClass: event.target.value }))
                      }
                      placeholder="ejemplo: naranja_buena"
                    />
                  </label>

                  <label>
                    Clase mala
                    <input
                      value={productForm.badClass}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, badClass: event.target.value }))
                      }
                      placeholder="ejemplo: naranja_mala"
                    />
                  </label>

                  <label>
                    Descripción
                    <input
                      value={productForm.description}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, description: event.target.value }))
                      }
                      placeholder="Descripción breve"
                    />
                  </label>

                  <label className="checkLine">
                    <input
                      type="checkbox"
                      checked={productForm.active}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, active: event.target.checked }))
                      }
                    />
                    Producto activo
                  </label>

                  <button className="btn primary" type="submit">
                    Guardar producto
                  </button>
                </form>
              </div>

              <div className="usersListCard">
                <div className="tableHeader">
                  <h2>Productos registrados</h2>
                  <div className="miniStats">
                    {stats.activeProducts}/{stats.products} activos
                  </div>
                </div>

                <div className="tableCard">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>ID</th>
                        <th>Clase buena</th>
                        <th>Clase mala</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.length === 0 && (
                        <tr>
                          <td colSpan="6">Aún no hay productos registrados.</td>
                        </tr>
                      )}

                      {products.map((item) => (
                        <tr key={item.productId || item.id}>
                          <td>
                            <strong>{item.icon} {item.name}</strong>
                          </td>
                          <td>{item.productId || item.id}</td>
                          <td>{item.goodClass}</td>
                          <td>{item.badClass}</td>
                          <td>
                            <span className={item.active ? "state active" : "state inactive"}>
                              {item.active ? "Activo" : "Inactivo"}
                            </span>
                          </td>
                          <td>
                            <div className="rowActions">
                              <button className="smallBtn" onClick={() => editProduct(item)}>
                                Editar
                              </button>
                              <button className="smallBtn danger" onClick={() => deleteProduct(item)}>
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {view === "images" && isAdmin && (
            <section className="usersGrid">
              <div className="userFormCard">
                <h2>Subir imagen al dataset</h2>
                <p>
                  La imagen se guarda en S3 y su información se registra en DynamoDB.
                  Esto no reentrena el modelo automáticamente.
                </p>

                <form onSubmit={uploadDatasetImage}>
                  <label>
                    Producto
                    <select
                      value={imageForm.productId}
                      onChange={(event) => {
                        const nextProductId = event.target.value;
                        const selected = products.find((item) => (item.productId || item.id) === nextProductId);
                        setImageForm((current) => ({
                          ...current,
                          productId: nextProductId,
                          className: selected?.goodClass || `${nextProductId}_buena`
                        }));
                      }}
                    >
                      {products.map((item) => (
                        <option key={item.productId || item.id} value={item.productId || item.id}>
                          {item.icon} {item.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Clase
                    <select
                      value={imageForm.className}
                      onChange={(event) =>
                        setImageForm((current) => ({ ...current, className: event.target.value }))
                      }
                    >
                      {selectedImageProduct?.goodClass && (
                        <option value={selectedImageProduct.goodClass}>
                          {selectedImageProduct.goodClass}
                        </option>
                      )}
                      {selectedImageProduct?.badClass && (
                        <option value={selectedImageProduct.badClass}>
                          {selectedImageProduct.badClass}
                        </option>
                      )}
                      <option value="no_reconocido">no_reconocido</option>
                    </select>
                  </label>

                  <label>
                    Imagen
                    <input
                      id="datasetImageFile"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) =>
                        setImageForm((current) => ({
                          ...current,
                          file: event.target.files?.[0] || null
                        }))
                      }
                    />
                  </label>

                  <button className="btn primary" type="submit">
                    Subir imagen a AWS
                  </button>
                </form>
              </div>

              <div className="usersListCard">
                <div className="tableHeader">
                  <h2>Imágenes registradas</h2>
                  <div className="miniStats">{stats.images} imágenes</div>
                </div>

                <div className="imageGrid">
                  {images.length === 0 && (
                    <div className="emptyBox">Aún no hay imágenes registradas.</div>
                  )}

                  {images.map((item) => (
                    <article className="imageCard" key={item.imageId || item.id}>
                      {item.url ? (
                        <img src={item.url} alt={item.filename || item.className} />
                      ) : (
                        <div className="imagePlaceholder">Sin vista previa</div>
                      )}

                      <div>
                        <strong>{item.productName || item.productId}</strong>
                        <span>{item.className}</span>
                        <small>{item.filename}</small>
                      </div>

                      <button className="smallBtn danger" onClick={() => deleteDatasetImage(item)}>
                        Eliminar
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}

          {view === "settings" && (
            <section className="diagnosticGrid">
              <div className="diagnosticCard">
                <h2>Rutas configuradas</h2>
                <p><strong>Backend/API:</strong> {CONFIG.API_URL}</p>
                <p><strong>Modelo TFJS:</strong> {CONFIG.MODEL_URL}</p>
                <p><strong>Metadata:</strong> {CONFIG.METADATA_URL}</p>
                <p><strong>Confianza mínima:</strong> {Math.round(CONFIG.MIN_CONFIDENCE * 100)}%</p>
                <p><strong>Delay servo:</strong> {CONFIG.SERVO_DELAY_MS} ms</p>
                <p><strong>Modo cloud:</strong> {cloudMode}</p>
                <p><strong>Usuarios AWS:</strong> {stats.users}</p>
                <p><strong>Productos AWS:</strong> {stats.products}</p>
                <p><strong>Imágenes AWS:</strong> {stats.images}</p>
              </div>

              <div className="diagnosticCard">
                <h2>Pruebas rápidas</h2>
                <button className="btn primary" onClick={testModelPath}>Probar carga del modelo</button>
                <button className="btn secondary" onClick={checkBackend}>Probar Backend/API</button>
                <button className="btn secondary" onClick={testServo}>Probar servo ahora</button>
              </div>
            </section>
          )}
        </section>
      </main>
    </>
  );
}

function AppStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      html, body, #root { min-height: 100%; }
      body {
        margin: 0;
        font-family: Inter, system-ui, Arial, sans-serif;
        color: #062014;
        background:
          radial-gradient(circle at top left, rgba(146, 231, 169, 0.45), transparent 34%),
          linear-gradient(135deg, #eef9f1 0%, #ffffff 58%, #eef7f2 100%);
      }
      button, input, select { font: inherit; }
      button { border: 0; cursor: pointer; }
      input, select {
        width: 100%;
        padding: 13px 14px;
        border: 1px solid #d7e8df;
        border-radius: 14px;
        outline: none;
        background: white;
      }
      label {
        display: grid;
        gap: 8px;
        font-weight: 900;
        color: #315742;
      }

      .loginPage {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
      }
      .loginCard {
        width: min(1100px, 100%);
        min-height: 600px;
        display: grid;
        grid-template-columns: 1.18fr 0.82fr;
        border-radius: 34px;
        overflow: hidden;
        background: white;
        box-shadow: 0 30px 85px rgba(4, 52, 26, 0.18);
      }
      .loginHero {
        padding: 72px;
        color: white;
        background:
          linear-gradient(135deg, rgba(1, 42, 20, 0.98), rgba(12, 96, 45, 0.90)),
          radial-gradient(circle at top, #65d56f, transparent 48%);
      }
      .logoBig {
        width: 92px;
        height: 92px;
        display: grid;
        place-items: center;
        border-radius: 28px;
        background: linear-gradient(135deg, #bef264, #22c55e);
        font-size: 48px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.22);
      }
      .loginHero h1 {
        margin: 30px 0 14px;
        font-size: clamp(42px, 7vw, 74px);
        line-height: 0.95;
      }
      .loginHero p {
        max-width: 590px;
        font-size: 19px;
        line-height: 1.7;
        opacity: 0.92;
      }
      .loginPanel {
        padding: 70px 54px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 16px;
      }
      .loginPanel h2 {
        margin: 0;
        font-size: 34px;
      }
      .loginPanel p {
        color: #5d6d62;
        line-height: 1.5;
      }

      .badge {
        display: inline-flex;
        width: fit-content;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.13);
        color: #15803d;
        font-size: 12px;
        font-weight: 950;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .loginHero .badge {
        margin-top: 26px;
        background: rgba(255, 255, 255, 0.16);
        color: white;
      }

      .btn, .smallBtn, .logout, .nav button, .controls button, .hardwareControls button {
        font-weight: 900;
        border-radius: 16px;
        transition: transform 0.15s ease, opacity 0.15s ease;
      }
      .btn:hover, .smallBtn:hover, .logout:hover, .nav button:hover, .controls button:hover, .hardwareControls button:hover {
        transform: translateY(-1px);
      }
      .btn { padding: 15px 18px; }
      .primary { color: white; background: #16a34a; }
      .secondary { color: #07351c; background: #e8f7ee; }
      .ghost { color: #126b35; background: #f4fbf6; border: 1px solid #d8eadf; }
      .google { color: #172554; background: #dbeafe; }
      .danger { color: white !important; background: #ef4444 !important; }

      .miniInfo {
        padding: 12px;
        border-radius: 14px;
        background: #f8fafc;
        color: #475569;
        font-size: 13px;
        word-break: break-all;
      }

      .alert, .success {
        padding: 14px 16px;
        border-radius: 16px;
        font-weight: 800;
        line-height: 1.45;
      }
      .alert {
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #991b1b;
      }
      .success {
        border: 1px solid #bbf7d0;
        background: #f0fdf4;
        color: #166534;
      }
      .topAlert { margin-bottom: 18px; }

      .appPage {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 310px 1fr;
      }
      .sidebar {
        min-height: 100vh;
        padding: 28px 22px;
        display: flex;
        flex-direction: column;
        gap: 22px;
        color: white;
        background: linear-gradient(180deg, #042a14, #0b5c2d);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .logoSmall {
        width: 58px;
        height: 58px;
        display: grid;
        place-items: center;
        border-radius: 18px;
        background: linear-gradient(135deg, #bef264, #22c55e);
        font-size: 32px;
      }
      .brand strong, .brand span { display: block; }
      .brand strong { font-size: 19px; }
      .brand span { opacity: 0.75; }

      .nav {
        display: grid;
        gap: 10px;
      }
      .nav button {
        width: 100%;
        padding: 15px 17px;
        text-align: left;
        color: white;
        background: transparent;
      }
      .nav button.active {
        color: #062014;
        background: white;
      }

      .sideStatus {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 13px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.10);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .sideStatus strong, .sideStatus small { display: block; }
      .sideStatus small { opacity: 0.78; }
      .dot {
        width: 13px;
        height: 13px;
        border-radius: 999px;
        background: #f59e0b;
        box-shadow: 0 0 0 5px rgba(245, 158, 11, 0.15);
      }
      .dot.ok {
        background: #22c55e;
        box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.15);
      }
      .dot.bad {
        background: #ef4444;
        box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.15);
      }

      .userCard {
        margin-top: auto;
        padding: 18px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.13);
        border: 1px solid rgba(255, 255, 255, 0.18);
      }
      .userCard span, .userCard strong, .userCard small { display: block; }
      .userCard span, .userCard small { opacity: 0.78; }
      .logout {
        padding: 15px 18px;
        color: white;
        background: rgba(255, 255, 255, 0.16);
      }

      .content { padding: 34px; }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 25px;
      }
      .header h1 {
        margin: 12px 0 0;
        font-size: clamp(30px, 4vw, 42px);
      }
      .headerActions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .smallBtn {
        padding: 11px 14px;
        color: #064e2a;
        background: white;
        border: 1px solid #dbece2;
        box-shadow: 0 10px 28px rgba(9, 55, 25, 0.08);
      }

      .scannerGrid {
        display: grid;
        grid-template-columns: minmax(520px, 1fr) 390px;
        gap: 26px;
        align-items: start;
      }
      .cameraCard, .resultCard, .tableCard, .stats div, .diagnosticCard, .userFormCard, .usersListCard {
        background: white;
        border: 1px solid rgba(6, 32, 20, 0.08);
        border-radius: 28px;
        box-shadow: 0 18px 45px rgba(9, 55, 25, 0.08);
      }
      .cameraCard { padding: 18px; }
      .cameraBox {
        position: relative;
        overflow: hidden;
        border-radius: 24px;
        background: #04150d;
        aspect-ratio: 16 / 10;
      }
      .cameraBox video, .cameraBox canvas, .cameraPlaceholder {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .cameraBox video { object-fit: cover; }
      .cameraBox canvas { pointer-events: none; }
      .cameraPlaceholder {
        display: grid;
        place-items: center;
        text-align: center;
        color: white;
        background:
          radial-gradient(circle at center, rgba(34, 197, 94, 0.14), transparent 44%),
          #04150d;
      }
      .cameraPlaceholder strong, .cameraPlaceholder span { display: block; }
      .cameraPlaceholder strong { font-size: 28px; }
      .cameraPlaceholder span { opacity: 0.75; margin-top: 9px; }

      .controls {
        margin-top: 16px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
      }
      .controls button {
        padding: 15px 12px;
        color: white;
      }
      .controls button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .blue { background: #60a5fa; }
      .green { background: #22c55e; }
      .yellow { color: #241200 !important; background: #f59e0b; }
      .red { background: #ef4444; }

      .hardwareControls {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .hardwareControls span {
        margin-right: 6px;
        color: #586c60;
        font-weight: 900;
      }
      .hardwareControls button {
        padding: 10px 12px;
        color: #062014;
        background: #eef7f2;
      }

      .resultCard { padding: 22px; }
      .resultHead {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 18px;
        border-radius: 22px;
        background: #f4fbf6;
      }
      .resultIcon {
        width: 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border-radius: 18px;
        background: white;
        font-size: 36px;
      }
      .resultHead span {
        color: #64746a;
        font-size: 12px;
        font-weight: 950;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .resultHead h2 {
        margin: 4px 0 0;
        font-size: 30px;
      }

      .productBox {
        margin-top: 18px;
        padding: 24px;
        border-radius: 24px;
        color: white;
        background: linear-gradient(135deg, #64748b, #334155);
      }
      .resultCard.good .productBox {
        background: linear-gradient(135deg, #16a34a, #22c55e);
      }
      .resultCard.bad .productBox, .resultCard.unknown .productBox {
        background: linear-gradient(135deg, #ef4444, #991b1b);
      }
      .resultCard.review .productBox {
        background: linear-gradient(135deg, #f59e0b, #d97706);
      }
      .labelChip {
        display: inline-block;
        max-width: 100%;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        font-size: 12px;
        font-weight: 950;
        overflow-wrap: anywhere;
      }
      .productBox h3 {
        margin: 18px 0 10px;
        font-size: 34px;
      }
      .productBox p {
        margin: 0;
        line-height: 1.6;
      }

      .metric {
        margin-top: 16px;
        padding: 18px;
        border: 1px solid #e5eee8;
        border-radius: 20px;
      }
      .metric > div:first-child {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .metric span, .metricGrid span {
        color: #64746a;
        font-weight: 900;
      }
      .metric strong { font-size: 28px; }
      .bar {
        height: 14px;
        margin-top: 16px;
        overflow: hidden;
        border-radius: 999px;
        background: #e9f2ed;
      }
      .bar i {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: #22c55e;
      }

      .metricGrid {
        margin-top: 14px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .metricGrid div, .support, .rankingBox {
        padding: 18px;
        border: 1px solid #e5eee8;
        border-radius: 20px;
      }
      .metricGrid strong {
        display: block;
        margin-top: 10px;
        font-size: 27px;
      }
      .rankingBox, .support { margin-top: 14px; }
      .rankingBox p, .support p {
        color: #586c60;
        line-height: 1.5;
        font-weight: 650;
      }
      .rankItem {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid #edf3ef;
      }
      .rankItem span { overflow-wrap: anywhere; }

      .stats {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 14px;
        margin-bottom: 20px;
      }
      .stats div { padding: 20px; }
      .stats span, .stats strong { display: block; }
      .stats span { color: #64746a; font-weight: 900; }
      .stats strong { margin-top: 8px; font-size: 34px; }

      .tableHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 12px;
      }
      .tableHeader h2 { margin: 0; }
      .tableCard { overflow: auto; }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 820px;
      }
      th, td {
        padding: 15px;
        border-bottom: 1px solid #e5eee8;
        text-align: left;
        vertical-align: middle;
      }
      th {
        color: #64746a;
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .usersGrid {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 20px;
        align-items: start;
      }
      .userFormCard, .usersListCard {
        padding: 24px;
      }
      .userFormCard h2, .usersListCard h2 {
        margin-top: 0;
      }
      .userFormCard p {
        color: #586c60;
        line-height: 1.5;
      }
      .userFormCard form {
        display: grid;
        gap: 15px;
      }
      .checkLine {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .checkLine input {
        width: auto;
      }
      .miniStats {
        padding: 8px 12px;
        border-radius: 999px;
        background: #ecfdf5;
        color: #166534;
        font-weight: 950;
      }
      .state {
        display: inline-flex;
        padding: 7px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 950;
      }
      .state.active {
        color: #166534;
        background: #dcfce7;
      }
      .state.inactive {
        color: #991b1b;
        background: #fee2e2;
      }
      .protectedTag {
        display: inline-flex;
        margin-left: 8px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #dbeafe;
        color: #1e3a8a;
        font-size: 11px;
        font-weight: 950;
      }
      .tableSelect {
        min-width: 150px;
        padding: 9px;
      }
      .rowActions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .rowActions .smallBtn {
        padding: 8px 10px;
        font-size: 13px;
      }

      .diagnosticGrid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      .diagnosticCard { padding: 24px; }
      .diagnosticCard p {
        padding: 10px 0;
        margin: 0;
        border-bottom: 1px solid #edf3ef;
        overflow-wrap: anywhere;
      }
      .diagnosticCard .btn {
        width: 100%;
        margin-top: 10px;
      }

      .selfRegisterBox, .manualLoginBox {
        display: grid;
        gap: 10px;
        padding: 14px;
        border: 1px solid #dbece2;
        border-radius: 18px;
        background: #f8fafc;
      }
      .selfRegisterBox h3 {
        margin: 0;
      }
      .selfRegisterBox p {
        margin: 0 0 4px;
        font-size: 13px;
      }

      .imageGrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 14px;
      }
      .imageCard {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid #e5eee8;
        border-radius: 18px;
        background: #f8fafc;
      }
      .imageCard img, .imagePlaceholder {
        width: 100%;
        aspect-ratio: 1 / 0.75;
        border-radius: 14px;
        object-fit: cover;
        background: #eaf5ee;
      }
      .imagePlaceholder {
        display: grid;
        place-items: center;
        color: #64746a;
        font-weight: 900;
      }
      .imageCard strong, .imageCard span, .imageCard small {
        display: block;
        overflow-wrap: anywhere;
      }
      .imageCard span {
        color: #166534;
        font-weight: 900;
      }
      .imageCard small {
        color: #64746a;
      }
      .emptyBox {
        padding: 20px;
        border: 1px dashed #cfe1d6;
        border-radius: 18px;
        color: #64746a;
        font-weight: 900;
      }

      @media (max-width: 1120px) {
        .appPage, .loginCard, .scannerGrid, .diagnosticGrid, .usersGrid {
          grid-template-columns: 1fr;
        }
        .sidebar { min-height: auto; }
        .controls, .stats { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 640px) {
        .content, .sidebar, .loginPage { padding: 18px; }
        .controls, .stats, .metricGrid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
