const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "cloud-db.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");

const DEFAULT_ADMIN = {
  id: "admin-principal",
  name: "Administrador Principal",
  email: "admin@smartvision.com",
  role: "Administrador",
  active: true,
  protected: true,
  provider: "Sistema",
  createdAt: "Inicial"
};

const DEFAULT_DB = {
  users: [
    DEFAULT_ADMIN,
    {
      id: "usuario-demo",
      name: "Usuario Operador",
      email: "operador@smartvision.com",
      role: "Usuario",
      active: true,
      protected: false,
      provider: "Sistema",
      createdAt: "Inicial"
    }
  ],
  products: [
    {
      id: "palta",
      name: "Palta",
      slug: "palta",
      icon: "🥑",
      active: true,
      accepted: true,
      goodClass: "palta_buena",
      badClass: "palta_mala",
      description: "Producto agrícola aceptado por el sistema."
    },
    {
      id: "mango",
      name: "Mango",
      slug: "mango",
      icon: "🥭",
      active: true,
      accepted: true,
      goodClass: "mango_bueno",
      badClass: "mango_mala",
      description: "Producto agrícola aceptado por el sistema."
    },
    {
      id: "jengibre",
      name: "Jengibre",
      slug: "jengibre",
      icon: "🫚",
      active: true,
      accepted: true,
      goodClass: "jengibre_bueno",
      badClass: "jengibre_malo",
      description: "Producto agrícola aceptado por el sistema."
    },
    {
      id: "curcuma",
      name: "Cúrcuma",
      slug: "curcuma",
      icon: "🟠",
      active: true,
      accepted: true,
      goodClass: "curcuma_buena",
      badClass: "curcuma_mala",
      description: "Producto agrícola aceptado por el sistema."
    }
  ],
  images: [],
  scanHistory: [],
  hardwareCommands: [],
  auditLog: []
};

function ensureFolders() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function ensureDb() {
  ensureFolders();

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), "utf8");
  }

  const db = readDb();

  db.users = Array.isArray(db.users) ? db.users : [];
  db.products = Array.isArray(db.products) ? db.products : [];
  db.images = Array.isArray(db.images) ? db.images : [];
  db.scanHistory = Array.isArray(db.scanHistory) ? db.scanHistory : [];
  db.hardwareCommands = Array.isArray(db.hardwareCommands) ? db.hardwareCommands : [];
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];

  const hasAdmin = db.users.some((user) => normalizeEmail(user.email) === normalizeEmail(DEFAULT_ADMIN.email));

  if (!hasAdmin) {
    db.users.unshift(DEFAULT_ADMIN);
  }

  db.users = db.users.map((user) => {
    if (normalizeEmail(user.email) === normalizeEmail(DEFAULT_ADMIN.email)) {
      return {
        ...DEFAULT_ADMIN,
        ...user,
        role: "Administrador",
        active: true,
        protected: true
      };
    }
    return user;
  });

  writeDb(db);
}

function readDb() {
  ensureFolders();

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), "utf8");
  }

  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  ensureFolders();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  return db;
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizeSlug(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function addAudit(db, action, payload = {}) {
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift({
    id: uid("audit"),
    action,
    payload,
    createdAt: new Date().toISOString()
  });
  db.auditLog = db.auditLog.slice(0, 500);
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  UPLOADS_DIR,
  DEFAULT_ADMIN,
  DEFAULT_DB,
  ensureDb,
  readDb,
  writeDb,
  uid,
  normalizeEmail,
  normalizeSlug,
  addAudit
};
