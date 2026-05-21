import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  History,
  Layers3,
  LogOut,
  Mail,
  Package,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
  Users
} from "lucide-react";
import "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import {
  auth,
  googleProvider,
  signInWithPopup,
  signOut,
  hasFirebaseConfig
} from "./firebase";
import "./App.css";

const ADMIN_EMAILS = ["michel.jaramillo@utec.edu.pe"]; // CAMBIA ESTE CORREO POR EL GMAIL REAL DEL ADMIN

const DEFAULT_ADMIN = {
  nombre: "Administrador Principal",
  email:"michel.jaramillo@utec.edu.pe",
  rol: "Administrador",
  estado: "Activo",
  metodo: "Predeterminado",
  protegido: true
};

const STORAGE_KEYS = {
  users: "spv_users",
  products: "spv_products",
  history: "spv_history"
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

function normalizeRole(roleName) {
  return roleName === "Administrador" ? "admin" : "usuario";
}

function App() {
  const [role, setRole] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [currentUser, setCurrentUser] = useState(null);
  const [pendingGoogleUser, setPendingGoogleUser] = useState(null);
  const [registrationName, setRegistrationName] = useState("");

  const [aiModel, setAiModel] = useState(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelStatus, setModelStatus] = useState("Cargando modelo IA...");

  const [scanDone, setScanDone] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanStage, setScanStage] = useState("Esperando imagen");
  const [imagePreview, setImagePreview] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [detectedProducts, setDetectedProducts] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);

  const videoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const imageRef = useRef(null);
  const overlayRef = useRef(null);

  const [products, setProducts] = useState(() =>
    loadStorage(STORAGE_KEYS.products, [
      {
        codigo: "P001",
        nombre: "Botella",
        categoria: "Bebidas",
        estado: "Activo"
      },
      {
        codigo: "P002",
        nombre: "Vaso / taza",
        categoria: "Bebidas",
        estado: "Activo"
      },
      {
        codigo: "P003",
        nombre: "Libro / caja",
        categoria: "Inventario",
        estado: "Activo"
      }
    ])
  );

  const [users, setUsers] = useState(() =>
    ensureDefaultAdmin(
      loadStorage(STORAGE_KEYS.users, [
        DEFAULT_ADMIN,
        {
          nombre: "Usuario Demo",
          email: "usuario@demo.com",
          rol: "Usuario",
          estado: "Activo",
          metodo: "Demo",
          protegido: false
        }
      ])
    )
  );

  const [historyLog, setHistoryLog] = useState(() =>
    loadStorage(STORAGE_KEYS.history, [
      {
        fecha: "20/05/2026",
        usuario: "Usuario Demo",
        resultado: "9 productos detectados",
        estado: "Validado"
      }
    ])
  );

  const [newProduct, setNewProduct] = useState({
    codigo: "",
    nombre: "",
    categoria: "",
    estado: "Activo"
  });

  const [newUser, setNewUser] = useState({
    nombre: "",
    email: "",
    rol: "Usuario",
    estado: "Activo",
    metodo: "Creado por admin",
    protegido: false
  });

  useEffect(() => {
    saveStorage(STORAGE_KEYS.users, users);
  }, [users]);

  useEffect(() => {
    saveStorage(STORAGE_KEYS.products, products);
  }, [products]);

  useEffect(() => {
    saveStorage(STORAGE_KEYS.history, historyLog);
  }, [historyLog]);

  useEffect(() => {
    let isMounted = true;

    const loadModel = async () => {
      try {
        setModelStatus("Cargando modelo IA...");
        const model = await cocoSsd.load();

        if (isMounted) {
          setAiModel(model);
          setModelReady(true);
          setModelStatus("Modelo IA listo");
          setScanStage("Modelo IA listo");
        }
      } catch (error) {
        console.error(error);
        setModelStatus("Error al cargar modelo IA");
        setModelReady(false);
      }
    };

    loadModel();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalDetected = useMemo(() => {
    return detectedProducts.reduce((acc, item) => acc + item.cantidad, 0);
  }, [detectedProducts]);

  const menuUsuario = [
    { id: "dashboard", label: "Dashboard", icon: <BarChart3 size={20} /> },
    { id: "scan", label: "Escanear productos", icon: <Camera size={20} /> },
    { id: "history", label: "Historial", icon: <History size={20} /> }
  ];

  const menuAdmin = [
    { id: "dashboard", label: "Dashboard", icon: <BarChart3 size={20} /> },
    { id: "products", label: "Productos", icon: <Package size={20} /> },
    { id: "users", label: "Usuarios", icon: <Users size={20} /> },
    { id: "history", label: "Historial", icon: <History size={20} /> }
  ];

  const screenTitle = {
    dashboard: "Dashboard general",
    scan: "Reconocimiento de productos",
    history: "Historial de conteos",
    products: "Gestión de productos",
    users: "Gestión de usuarios"
  };

  const menu = role === "admin" ? menuAdmin : menuUsuario;

  const translateClass = (className) => {
    const labels = {
      bottle: "Botella",
      cup: "Vaso / taza",
      bowl: "Bowl",
      banana: "Plátano",
      apple: "Manzana",
      orange: "Naranja",
      sandwich: "Sándwich",
      pizza: "Pizza",
      cake: "Queque / torta",
      book: "Libro / caja",
      "cell phone": "Celular",
      laptop: "Laptop",
      keyboard: "Teclado",
      mouse: "Mouse",
      remote: "Control remoto",
      chair: "Silla",
      person: "Persona",
      backpack: "Mochila",
      handbag: "Bolsa",
      suitcase: "Maleta",
      tv: "Televisor"
    };

    return labels[className] || className;
  };

  const getCategory = (className) => {
    const food = ["banana", "apple", "orange", "sandwich", "pizza", "cake"];
    const drinks = ["bottle", "cup"];
    const tech = ["cell phone", "laptop", "keyboard", "mouse", "remote", "tv"];
    const inventory = ["book", "backpack", "handbag", "suitcase"];

    if (food.includes(className)) return "Alimentos";
    if (drinks.includes(className)) return "Bebidas";
    if (tech.includes(className)) return "Tecnología";
    if (inventory.includes(className)) return "Inventario";

    return "Objeto detectado";
  };

  const groupPredictions = (predictions) => {
    const grouped = {};

    predictions.forEach((prediction) => {
      const key = prediction.class;

      if (!grouped[key]) {
        grouped[key] = {
          producto: translateClass(key),
          categoria: getCategory(key),
          cantidad: 0,
          confianzaTotal: 0
        };
      }

      grouped[key].cantidad += 1;
      grouped[key].confianzaTotal += prediction.score;
    });

    return Object.values(grouped).map((item) => ({
      producto: item.producto,
      categoria: item.categoria,
      cantidad: item.cantidad,
      confianza: `${Math.round((item.confianzaTotal / item.cantidad) * 100)}%`
    }));
  };

  const drawPredictions = (predictions) => {
    const canvas = overlayRef.current;
    const image = imageRef.current;

    if (!canvas || !image) return;

    const displayWidth = image.clientWidth;
    const displayHeight = image.clientHeight;

    if (!displayWidth || !displayHeight || !image.naturalWidth) return;

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = displayWidth / image.naturalWidth;
    const scaleY = displayHeight / image.naturalHeight;

    predictions.forEach((prediction) => {
      const [x, y, width, height] = prediction.bbox;

      const boxX = x * scaleX;
      const boxY = y * scaleY;
      const boxWidth = width * scaleX;
      const boxHeight = height * scaleY;

      const label = `${translateClass(prediction.class)} ${Math.round(
        prediction.score * 100
      )}%`;

      context.strokeStyle = "#22c55e";
      context.lineWidth = 3;
      context.strokeRect(boxX, boxY, boxWidth, boxHeight);

      context.fillStyle = "#22c55e";
      context.font = "bold 14px Arial";
      context.fillRect(
        boxX,
        boxY > 28 ? boxY - 28 : boxY,
        label.length * 8.5,
        26
      );

      context.fillStyle = "#ffffff";
      context.fillText(label, boxX + 6, boxY > 28 ? boxY - 10 : boxY + 18);
    });
  };

  const accessWithUser = (systemUser) => {
    if (systemUser.estado !== "Activo") {
      alert("Tu usuario está inactivo. Contacta al administrador.");
      return;
    }

    setCurrentUser(systemUser);
    setRole(normalizeRole(systemUser.rol));
    setScreen("dashboard");
  };

  const handleGoogleAccess = async () => {
    if (!hasFirebaseConfig || !auth || !googleProvider) {
      alert("Firebase todavía no está configurado correctamente.");
      return;
    }

    try {
      setGoogleLoading(true);

      const result = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;
      const email = googleUser.email || "";
      const name = googleUser.displayName || "";

      const isAdminEmail = ADMIN_EMAILS.includes(email);

      if (isAdminEmail) {
        const adminUser = {
          nombre: name || "Administrador",
          email,
          rol: "Administrador",
          estado: "Activo",
          metodo: "Google",
          protegido: true
        };

        setUsers((prevUsers) => {
          const exists = prevUsers.some((user) => user.email === email);
          if (exists) {
            return prevUsers.map((user) =>
              user.email === email ? { ...user, ...adminUser } : user
            );
          }
          return [adminUser, ...prevUsers];
        });

        accessWithUser(adminUser);
        return;
      }

      const existingUser = users.find((user) => user.email === email);

      if (existingUser) {
        accessWithUser(existingUser);
        return;
      }

      setPendingGoogleUser({
        nombre: name,
        email,
        metodo: "Google"
      });

      setRegistrationName(name || "");
    } catch (error) {
      console.error(error);
      alert("No se pudo iniciar sesión con Google.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const completeUserRegistration = (event) => {
    event.preventDefault();

    if (!pendingGoogleUser) return;

    if (registrationName.trim() === "") {
      alert("Ingresa tu nombre para completar el registro.");
      return;
    }

    const userToCreate = {
      nombre: registrationName.trim(),
      email: pendingGoogleUser.email,
      rol: "Usuario",
      estado: "Activo",
      metodo: "Google",
      protegido: false
    };

    setUsers((prevUsers) => [userToCreate, ...prevUsers]);
    setPendingGoogleUser(null);
    setRegistrationName("");
    accessWithUser(userToCreate);
  };

  const cancelRegistration = async () => {
    if (auth) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error(error);
      }
    }

    setPendingGoogleUser(null);
    setRegistrationName("");
  };

  const loginAsDefaultAdmin = () => {
    accessWithUser(DEFAULT_ADMIN);
  };

  const handleCreateUser = (event) => {
    event.preventDefault();

    if (
      newUser.nombre.trim() === "" ||
      newUser.email.trim() === "" ||
      newUser.rol.trim() === ""
    ) {
      alert("Completa nombre, correo y rol del usuario.");
      return;
    }

    const emailExists = users.some(
      (user) => user.email.toLowerCase() === newUser.email.toLowerCase()
    );

    if (emailExists) {
      alert("Ya existe un usuario con ese correo.");
      return;
    }

    setUsers([
      {
        ...newUser,
        nombre: newUser.nombre.trim(),
        email: newUser.email.trim().toLowerCase()
      },
      ...users
    ]);

    setNewUser({
      nombre: "",
      email: "",
      rol: "Usuario",
      estado: "Activo",
      metodo: "Creado por admin",
      protegido: false
    });
  };

  const handleDeleteUser = (email) => {
    const userToDelete = users.find((user) => user.email === email);

    if (!userToDelete) return;

    if (userToDelete.protegido) {
      alert("No puedes eliminar al administrador predeterminado.");
      return;
    }

    if (currentUser?.email === email) {
      alert("No puedes eliminar tu propio usuario mientras estás conectado.");
      return;
    }

    const confirmDelete = confirm(`¿Eliminar al usuario ${userToDelete.nombre}?`);

    if (!confirmDelete) return;

    setUsers(users.filter((user) => user.email !== email));
  };

  const handleAddProduct = (event) => {
    event.preventDefault();

    if (
      newProduct.codigo.trim() === "" ||
      newProduct.nombre.trim() === "" ||
      newProduct.categoria.trim() === ""
    ) {
      alert("Completa código, nombre y categoría del producto.");
      return;
    }

    setProducts([...products, newProduct]);

    setNewProduct({
      codigo: "",
      nombre: "",
      categoria: "",
      estado: "Activo"
    });
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];

    if (!file) return;

    const imageUrl = URL.createObjectURL(file);

    setImagePreview(imageUrl);
    setScanDone(false);
    setScanLoading(false);
    setDetectedProducts([]);
    setScanStage("Imagen cargada");
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment"
        },
        audio: false
      });

      setCameraActive(true);
      setScanDone(false);
      setScanLoading(false);
      setDetectedProducts([]);
      setScanStage("Cámara activa");

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 150);
    } catch (error) {
      console.error(error);
      alert("No se pudo acceder a la cámara. Puedes subir una imagen manualmente.");
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  };

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;

    if (!video || !cameraActive) {
      alert("Primero activa la cámara.");
      return;
    }

    if (!video.videoWidth || !video.videoHeight) {
      alert("La cámara aún está cargando. Intenta nuevamente en unos segundos.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL("image/png");

    setImagePreview(imageData);
    setScanDone(false);
    setScanLoading(false);
    setDetectedProducts([]);
    setScanStage("Imagen capturada");
  };

  const runRealAIRecognition = async () => {
    if (!imagePreview) {
      alert("Primero sube una imagen o captura una foto con la cámara.");
      return;
    }

    if (!aiModel || !modelReady) {
      alert("El modelo de IA todavía está cargando. Intenta nuevamente.");
      return;
    }

    const image = imageRef.current;

    if (!image) {
      alert("No se encontró la imagen para analizar.");
      return;
    }

    try {
      setScanDone(false);
      setScanLoading(true);
      setDetectedProducts([]);
      setScanStage("Procesando imagen con IA real...");

      await new Promise((resolve) => setTimeout(resolve, 500));

      setScanStage("Detectando objetos con visión computacional...");

      const predictions = await aiModel.detect(image);

      const filteredPredictions = predictions.filter(
        (prediction) => prediction.score >= 0.45
      );

      const groupedProducts = groupPredictions(filteredPredictions);
      const total = groupedProducts.reduce((acc, item) => acc + item.cantidad, 0);

      setDetectedProducts(groupedProducts);

      setTimeout(() => {
        drawPredictions(filteredPredictions);
      }, 100);

      setHistoryLog((prevHistory) => [
        {
          fecha: new Date().toLocaleString("es-PE"),
          usuario: currentUser?.nombre || "Usuario",
          resultado:
            total > 0
              ? `${total} objetos detectados por IA`
              : "Sin detecciones confiables",
          estado: total > 0 ? "Validado" : "Pendiente"
        },
        ...prevHistory
      ]);

      setScanLoading(false);
      setScanDone(true);
      setScanStage("Análisis completado");
    } catch (error) {
      console.error(error);
      setScanLoading(false);
      setScanDone(false);
      setScanStage("Error durante el análisis IA");
      alert("Ocurrió un error al analizar la imagen con IA.");
    }
  };

  const logout = async () => {
    stopCamera();

    if (auth) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error(error);
      }
    }

    setRole(null);
    setCurrentUser(null);
    setPendingGoogleUser(null);
    setScreen("dashboard");
    setScanDone(false);
    setScanLoading(false);
    setImagePreview(null);
    setDetectedProducts([]);
    setScanStage("Esperando imagen");
  };

  if (pendingGoogleUser && !role) {
    return (
      <div className="registration-shell">
        <div className="registration-card">
          <div className="brand-mark small">
            <UserPlus size={28} />
          </div>

          <p className="eyebrow">Registro de usuario</p>

          <h1>Completa tu registro</h1>

          <p>
            Tu cuenta de Google fue validada. Ahora debes crear tu usuario dentro
            del sistema para ingresar como perfil Usuario.
          </p>

          <form onSubmit={completeUserRegistration} className="registration-form">
            <label>Correo Gmail</label>
            <input value={pendingGoogleUser.email} disabled />

            <label>Nombre completo</label>
            <input
              value={registrationName}
              onChange={(event) => setRegistrationName(event.target.value)}
              placeholder="Ingresa tu nombre"
            />

            <label>Rol asignado</label>
            <input value="Usuario" disabled />

            <button className="primary-action full-width" type="submit">
              Crear mi usuario
            </button>

            <button
              className="secondary-action full-width"
              type="button"
              onClick={cancelRegistration}
            >
              Cancelar
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="login-shell">
        <div className="login-background-glow glow-one"></div>
        <div className="login-background-glow glow-two"></div>

        <section className="login-hero">
          <div className="brand-mark">
            <Boxes size={34} />
          </div>

          <div className="hero-badge">
            <Sparkles size={16} />
            Cognitive Computing Project
          </div>

          <h1>Smart Product Vision</h1>

          <p>
            Plataforma inteligente para reconocer, clasificar y contar productos
            usando cámara, inteligencia artificial y autenticación con Gmail.
          </p>

          <div className="hero-flow">
            <div>
              <Camera size={20} />
              Cámara
            </div>

            <span></span>

            <div>
              <Cpu size={20} />
              IA real
            </div>

            <span></span>

            <div>
              <BarChart3 size={20} />
              Dashboard
            </div>
          </div>
        </section>

        <section className="login-card-pro">
          <div className="login-card-header">
            <div>
              <p className="eyebrow">Bienvenido</p>
              <h2>Acceso al sistema</h2>
            </div>

            <ShieldCheck size={30} />
          </div>

          <p className="login-description">
            Si eres usuario nuevo, ingresa con Gmail y completa tu registro. El
            administrador predeterminado ya existe en el sistema.
          </p>

          <button className="google-button" onClick={handleGoogleAccess}>
            <GoogleIcon />
            {googleLoading ? "Conectando con Gmail..." : "Ingresar / Registrarse con Gmail"}
          </button>

          <div className="divider-text">
            <span>administrador predeterminado</span>
          </div>

          <button className="role-card" onClick={loginAsDefaultAdmin}>
            <div className="role-icon admin-role">
              <ShieldCheck size={24} />
            </div>

            <div>
              <strong>Ingresar como Administrador</strong>
              <span>Usuario administrador creado por defecto.</span>
            </div>
          </button>

          <div className="login-footer">
            <CheckCircle2 size={17} />
            Login Gmail + gestión de usuarios + IA real
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar-pro">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <Boxes size={26} />
          </div>

          <div>
            <h2>Smart Vision</h2>
            <p>{role === "admin" ? "Administrador" : "Usuario"}</p>
          </div>
        </div>

        <div className="user-mini-card">
          <strong>{currentUser?.nombre}</strong>
          <span>{currentUser?.email}</span>
          <small>{currentUser?.metodo}</small>
        </div>

        <nav className="sidebar-menu">
          {menu.map((item) => (
            <button
              key={item.id}
              className={screen === item.id ? "menu-item active" : "menu-item"}
              onClick={() => setScreen(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <div>
            <span className={modelReady ? "status-dot" : "status-dot loading"}></span>
            {modelStatus}
          </div>

          <small>TensorFlow.js + COCO-SSD</small>
        </div>

        <button className="logout-btn" onClick={logout}>
          <LogOut size={19} />
          Cerrar sesión
        </button>
      </aside>

      <main className="content-pro">
        <header className="topbar-pro">
          <div>
            <p className="eyebrow">Smart Product Vision</p>
            <h1>{screenTitle[screen]}</h1>

            <span>
              Sistema de reconocimiento y conteo automático de productos mediante
              IA.
            </span>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={18} />
              <input placeholder="Buscar..." />
            </div>

            <div className={modelReady ? "ai-chip" : "ai-chip loading-chip"}>
              <Sparkles size={17} />
              {modelReady ? "IA activa" : "Cargando IA"}
            </div>
          </div>
        </header>

        {screen === "dashboard" && (
          <section className="screen-section">
            <div className="metrics-grid">
              <MetricCard
                icon={<Package />}
                label="Productos registrados"
                value={products.length}
                detail="Productos base para reconocimiento"
              />

              <MetricCard
                icon={<Camera />}
                label="Escaneos realizados"
                value={historyLog.length}
                detail="Imágenes procesadas por IA"
              />

              <MetricCard
                icon={<Users />}
                label="Usuarios"
                value={users.length}
                detail="Usuarios registrados en el sistema"
              />

              <MetricCard
                icon={<CheckCircle2 />}
                label="Motor IA"
                value={modelReady ? "Activo" : "Cargando"}
                detail="TensorFlow.js con COCO-SSD"
              />
            </div>

            <div className="dashboard-grid">
              <div className="panel-pro wide-panel">
                <div className="panel-header">
                  <div>
                    <h2>Resumen del proyecto</h2>
                    <p>Propuesta validada para Cognitive Computing</p>
                  </div>

                  <ClipboardCheck size={26} />
                </div>

                <p className="body-text">
                  Smart Product Vision utiliza una cámara como hardware de entrada
                  para capturar imágenes de productos. Luego, un modelo de visión
                  computacional identifica objetos, calcula cantidades y registra
                  los resultados. El sistema incluye perfiles de usuario y
                  administrador, registro con Gmail y gestión de usuarios.
                </p>

                <div className="process-flow">
                  <FlowItem icon={<Mail />} title="Gmail" />
                  <FlowItem icon={<Camera />} title="Cámara" />
                  <FlowItem icon={<Cpu />} title="IA real" />
                  <FlowItem icon={<Database />} title="Registro" />
                  <FlowItem icon={<BarChart3 />} title="Reporte" />
                </div>
              </div>

              <div className="panel-pro">
                <h2>Alcance del 30%</h2>

                <ul className="check-list">
                  <li>Administrador predeterminado</li>
                  <li>Registro de usuario con Gmail</li>
                  <li>Gestión de usuarios</li>
                  <li>Gestión de productos</li>
                  <li>Cámara como hardware</li>
                  <li>Reconocimiento real con IA</li>
                  <li>Historial de conteos</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {screen === "scan" && (
          <section className="screen-section">
            <div className="scan-layout">
              <div className="upload-panel">
                <div className="upload-icon">
                  <Camera size={48} />
                </div>

                <h2>Captura inteligente de productos</h2>

                <p>
                  Usa la cámara como hardware de entrada o sube una imagen. El
                  sistema analizará la imagen con IA real.
                </p>

                <canvas ref={captureCanvasRef} style={{ display: "none" }} />

                {cameraActive ? (
                  <div className="live-camera">
                    <video ref={videoRef} autoPlay playsInline muted />
                  </div>
                ) : (
                  <div className="empty-preview">
                    <Camera size={42} />
                    <span>Cámara desactivada</span>
                  </div>
                )}

                <div className="scan-actions">
                  <button className="secondary-action" onClick={startCamera}>
                    Activar cámara
                  </button>

                  <button className="secondary-action" onClick={captureFrame}>
                    Capturar imagen
                  </button>

                  <button className="danger-action" onClick={stopCamera}>
                    Apagar cámara
                  </button>
                </div>

                <div className="divider-text">
                  <span>o subir imagen manualmente</span>
                </div>

                <label className="upload-button">
                  <UploadCloud size={18} />
                  Seleccionar imagen
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                  />
                </label>

                {imagePreview && (
                  <div className="preview-card ai-preview">
                    <img
                      ref={imageRef}
                      src={imagePreview}
                      alt="Vista previa"
                      onLoad={() => {
                        if (overlayRef.current && imageRef.current) {
                          overlayRef.current.width = imageRef.current.clientWidth;
                          overlayRef.current.height = imageRef.current.clientHeight;
                        }
                      }}
                    />

                    <canvas ref={overlayRef} className="detection-canvas" />
                  </div>
                )}

                <button
                  className="primary-action"
                  onClick={runRealAIRecognition}
                  disabled={!modelReady}
                >
                  <Sparkles size={18} />
                  {modelReady ? "Escanear con IA real" : "Cargando modelo IA..."}
                </button>
              </div>

              <div className="panel-pro results-panel">
                <div className="panel-header">
                  <div>
                    <h2>Resultados del análisis</h2>
                    <p>Productos detectados por visión computacional</p>
                  </div>

                  <Cpu size={26} />
                </div>

                {scanLoading && (
                  <div className="scan-loader">
                    <div className="loader-circle">
                      <Sparkles size={34} />
                    </div>

                    <h3>{scanStage}</h3>

                    <div className="loader-bar">
                      <span></span>
                    </div>

                    <p>
                      La IA está analizando la imagen, identificando objetos y
                      estimando cantidades.
                    </p>
                  </div>
                )}

                {!scanLoading && !scanDone && (
                  <div className="empty-state">
                    <Search size={42} />
                    <h3>Aún no se ha procesado la imagen</h3>
                    <p>Activa la cámara o sube una imagen para iniciar.</p>
                  </div>
                )}

                {!scanLoading && scanDone && (
                  <>
                    <div className="recognition-summary">
                      <div>
                        <span>Estado</span>
                        <strong>Reconocimiento ejecutado</strong>
                      </div>

                      <div>
                        <span>Total detectado</span>
                        <strong>{totalDetected} objetos</strong>
                      </div>

                      <div>
                        <span>Motor IA</span>
                        <strong>COCO-SSD</strong>
                      </div>
                    </div>

                    {detectedProducts.length === 0 && (
                      <div className="no-detections">
                        <AlertTriangle size={24} />
                        <strong>No se detectaron productos confiables.</strong>
                        <p>
                          Prueba con una imagen más clara, buena iluminación y
                          objetos separados.
                        </p>
                      </div>
                    )}

                    {detectedProducts.length > 0 && (
                      <table>
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th>Categoría</th>
                            <th>Cantidad</th>
                            <th>Confianza</th>
                          </tr>
                        </thead>

                        <tbody>
                          {detectedProducts.map((item, index) => (
                            <tr key={index}>
                              <td>{item.producto}</td>
                              <td>{item.categoria}</td>
                              <td>{item.cantidad}</td>
                              <td>
                                <span className="tag success">
                                  {item.confianza}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {screen === "products" && role === "admin" && (
          <section className="screen-section">
            <div className="panel-pro">
              <div className="panel-header">
                <div>
                  <h2>Registrar producto</h2>
                  <p>Base de productos que serán reconocidos por la IA</p>
                </div>

                <Package size={26} />
              </div>

              <form className="form-grid" onSubmit={handleAddProduct}>
                <FormInput
                  label="Código"
                  placeholder="P004"
                  value={newProduct.codigo}
                  onChange={(value) =>
                    setNewProduct({ ...newProduct, codigo: value })
                  }
                />

                <FormInput
                  label="Producto"
                  placeholder="Mouse"
                  value={newProduct.nombre}
                  onChange={(value) =>
                    setNewProduct({ ...newProduct, nombre: value })
                  }
                />

                <FormInput
                  label="Categoría"
                  placeholder="Tecnología"
                  value={newProduct.categoria}
                  onChange={(value) =>
                    setNewProduct({ ...newProduct, categoria: value })
                  }
                />

                <div className="form-field">
                  <label>Estado</label>
                  <select
                    value={newProduct.estado}
                    onChange={(event) =>
                      setNewProduct({
                        ...newProduct,
                        estado: event.target.value
                      })
                    }
                  >
                    <option>Activo</option>
                    <option>Inactivo</option>
                  </select>
                </div>

                <button className="form-button" type="submit">
                  <PlusCircle size={18} />
                  Agregar
                </button>
              </form>
            </div>

            <DataPanel
              title="Productos registrados"
              subtitle="Listado de productos configurados"
              columns={["Código", "Producto", "Categoría", "Estado"]}
              rows={products.map((item) => [
                item.codigo,
                item.nombre,
                item.categoria,
                <span
                  className={
                    item.estado === "Activo" ? "tag success" : "tag warning"
                  }
                >
                  {item.estado}
                </span>
              ])}
            />
          </section>
        )}

        {screen === "users" && role === "admin" && (
          <section className="screen-section">
            <div className="panel-pro">
              <div className="panel-header">
                <div>
                  <h2>Crear usuario</h2>
                  <p>
                    El administrador puede registrar usuarios autorizados para el
                    sistema.
                  </p>
                </div>

                <UserPlus size={26} />
              </div>

              <form className="admin-user-form" onSubmit={handleCreateUser}>
                <FormInput
                  label="Nombre"
                  placeholder="Nombre del usuario"
                  value={newUser.nombre}
                  onChange={(value) => setNewUser({ ...newUser, nombre: value })}
                />

                <FormInput
                  label="Correo"
                  placeholder="correo@gmail.com"
                  value={newUser.email}
                  onChange={(value) => setNewUser({ ...newUser, email: value })}
                />

                <div className="form-field">
                  <label>Rol</label>
                  <select
                    value={newUser.rol}
                    onChange={(event) =>
                      setNewUser({ ...newUser, rol: event.target.value })
                    }
                  >
                    <option>Usuario</option>
                    <option>Administrador</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Estado</label>
                  <select
                    value={newUser.estado}
                    onChange={(event) =>
                      setNewUser({ ...newUser, estado: event.target.value })
                    }
                  >
                    <option>Activo</option>
                    <option>Inactivo</option>
                  </select>
                </div>

                <button className="form-button" type="submit">
                  <PlusCircle size={18} />
                  Crear usuario
                </button>
              </form>
            </div>

            <div className="panel-pro">
              <div className="panel-header">
                <div>
                  <h2>Usuarios del sistema</h2>
                  <p>Usuarios creados, registrados con Gmail y predeterminados.</p>
                </div>

                <Database size={26} />
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Correo</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Método</th>
                      <th>Acción</th>
                    </tr>
                  </thead>

                  <tbody>
                    {users.map((item) => (
                      <tr key={item.email}>
                        <td>{item.nombre}</td>
                        <td>{item.email}</td>
                        <td>{item.rol}</td>
                        <td>
                          <span
                            className={
                              item.estado === "Activo"
                                ? "tag success"
                                : "tag warning"
                            }
                          >
                            {item.estado}
                          </span>
                        </td>
                        <td>{item.metodo}</td>
                        <td>
                          <button
                            className="danger-small"
                            onClick={() => handleDeleteUser(item.email)}
                          >
                            <Trash2 size={15} />
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {screen === "history" && (
          <section className="screen-section">
            <DataPanel
              title="Historial de conteos"
              subtitle="Registro de escaneos realizados por usuarios"
              columns={["Fecha", "Usuario", "Resultado", "Estado"]}
              rows={historyLog.map((item) => [
                item.fecha,
                item.usuario,
                item.resultado,
                <span
                  className={
                    item.estado === "Validado" ? "tag success" : "tag warning"
                  }
                >
                  {item.estado}
                </span>
              ])}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function MetricCard({ icon, label, value, detail }) {
  return (
    <div className="metric-card-pro">
      <div className="metric-icon">{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function FlowItem({ icon, title }) {
  return (
    <div className="flow-item">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function FormInput({ label, placeholder, value, onChange }) {
  return (
    <div className="form-field">
      <label>{label}</label>

      <input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function DataPanel({ title, subtitle, columns, rows }) {
  return (
    <div className="panel-pro">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <Database size={26} />
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default App;