const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const {
  UPLOADS_DIR,
  ensureDb,
  readDb,
  writeDb,
  uid,
  normalizeEmail,
  normalizeSlug,
  addAudit
} = require("./cloudDataStore");

ensureDb();

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const productId = req.body.productId || "general";
    const className = req.body.className || "sin_clase";

    const folder = path.join(
      UPLOADS_DIR,
      "dataset",
      normalizeSlug(productId),
      normalizeSlug(className)
    );

    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg").toLowerCase() || ".jpg";
    cb(null, `${Date.now()}_${uid("img")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (!ok) return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP."));
    cb(null, true);
  }
});

function cleanUser(user) {
  return {
    id: user.id || uid("user"),
    name: String(user.name || "").trim(),
    email: normalizeEmail(user.email),
    role: user.role === "Administrador" ? "Administrador" : "Usuario",
    active: user.protected ? true : Boolean(user.active),
    protected: Boolean(user.protected),
    provider: user.provider || "Manual",
    photoURL: user.photoURL || "",
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: user.updatedAt || null
  };
}

function findById(items, id) {
  return items.find((item) => item.id === id);
}

function queueHardwareCommand(type, payload = {}) {
  const db = readDb();

  const command = {
    id: uid("cmd"),
    type,
    payload,
    status: "PENDING",
    targetDeviceId: payload.deviceId || process.env.ESP32_DEVICE_ID || "esp32-principal",
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    completedAt: null
  };

  db.hardwareCommands = Array.isArray(db.hardwareCommands) ? db.hardwareCommands : [];
  db.hardwareCommands.push(command);
  addAudit(db, "QUEUE_HARDWARE_COMMAND", { type, commandId: command.id });
  writeDb(db);

  return command;
}

/* =========================
   CLOUD HEALTH
========================= */

router.get("/cloud/health", (req, res) => {
  const db = readDb();

  res.json({
    ok: true,
    service: "Agro Quality AI Cloud Ready API",
    mode: "cloud-polling",
    totals: {
      users: db.users.length,
      products: db.products.length,
      images: db.images.length,
      scanHistory: db.scanHistory.length,
      pendingCommands: db.hardwareCommands.filter((cmd) => cmd.status === "PENDING").length
    }
  });
});

/* =========================
   USERS
========================= */

router.get("/cloud/users", (req, res) => {
  const db = readDb();
  res.json({ ok: true, users: db.users });
});

router.post("/cloud/users", (req, res) => {
  const db = readDb();

  const email = normalizeEmail(req.body.email);
  const name = String(req.body.name || "").trim();

  if (!email || !name) {
    return res.status(400).json({ ok: false, error: "Nombre y correo son obligatorios." });
  }

  const exists = db.users.some((user) => normalizeEmail(user.email) === email);

  if (exists) {
    return res.status(409).json({ ok: false, error: "El usuario ya existe." });
  }

  const user = cleanUser({
    id: uid("user"),
    name,
    email,
    role: req.body.role || "Usuario",
    active: req.body.active ?? true,
    provider: req.body.provider || "Manual",
    protected: false
  });

  db.users.push(user);
  addAudit(db, "CREATE_USER", { id: user.id, email: user.email });
  writeDb(db);

  res.status(201).json({ ok: true, user });
});

router.put("/cloud/users/:id", (req, res) => {
  const db = readDb();
  const user = findById(db.users, req.params.id);

  if (!user) {
    return res.status(404).json({ ok: false, error: "Usuario no encontrado." });
  }

  if (user.protected) {
    user.name = req.body.name || user.name;
    user.role = "Administrador";
    user.active = true;
    user.updatedAt = new Date().toISOString();
  } else {
    user.name = req.body.name ?? user.name;
    user.email = normalizeEmail(req.body.email ?? user.email);
    user.role = req.body.role ?? user.role;
    user.active = req.body.active ?? user.active;
    user.updatedAt = new Date().toISOString();
  }

  addAudit(db, "UPDATE_USER", { id: user.id, email: user.email });
  writeDb(db);

  res.json({ ok: true, user });
});

router.patch("/cloud/users/:id/active", (req, res) => {
  const db = readDb();
  const user = findById(db.users, req.params.id);

  if (!user) {
    return res.status(404).json({ ok: false, error: "Usuario no encontrado." });
  }

  if (user.protected) {
    return res.status(400).json({ ok: false, error: "El administrador principal no se puede desactivar." });
  }

  user.active = Boolean(req.body.active);
  user.updatedAt = new Date().toISOString();

  addAudit(db, user.active ? "ACTIVATE_USER" : "DEACTIVATE_USER", {
    id: user.id,
    email: user.email
  });
  writeDb(db);

  res.json({ ok: true, user });
});

router.delete("/cloud/users/:id", (req, res) => {
  const db = readDb();
  const user = findById(db.users, req.params.id);

  if (!user) {
    return res.status(404).json({ ok: false, error: "Usuario no encontrado." });
  }

  if (user.protected) {
    return res.status(400).json({ ok: false, error: "El administrador principal no se puede eliminar." });
  }

  db.users = db.users.filter((item) => item.id !== req.params.id);
  addAudit(db, "DELETE_USER", { id: user.id, email: user.email });
  writeDb(db);

  res.json({ ok: true, deleted: user });
});

/* =========================
   PRODUCTS / FRUITS
========================= */

router.get("/cloud/products", (req, res) => {
  const db = readDb();
  res.json({ ok: true, products: db.products });
});

router.post("/cloud/products", (req, res) => {
  const db = readDb();

  const name = String(req.body.name || "").trim();
  const slug = normalizeSlug(req.body.slug || name);

  if (!name || !slug) {
    return res.status(400).json({ ok: false, error: "Nombre del producto es obligatorio." });
  }

  const exists = db.products.some((product) => product.id === slug || product.slug === slug);

  if (exists) {
    return res.status(409).json({ ok: false, error: "El producto ya existe." });
  }

  const product = {
    id: slug,
    name,
    slug,
    icon: req.body.icon || "🌱",
    active: req.body.active ?? true,
    accepted: req.body.accepted ?? true,
    goodClass: req.body.goodClass || `${slug}_buena`,
    badClass: req.body.badClass || `${slug}_mala`,
    description: req.body.description || "",
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  db.products.push(product);
  addAudit(db, "CREATE_PRODUCT", { id: product.id, name: product.name });
  writeDb(db);

  res.status(201).json({ ok: true, product });
});

router.put("/cloud/products/:id", (req, res) => {
  const db = readDb();
  const product = findById(db.products, req.params.id);

  if (!product) {
    return res.status(404).json({ ok: false, error: "Producto no encontrado." });
  }

  product.name = req.body.name ?? product.name;
  product.icon = req.body.icon ?? product.icon;
  product.active = req.body.active ?? product.active;
  product.accepted = req.body.accepted ?? product.accepted;
  product.goodClass = req.body.goodClass ?? product.goodClass;
  product.badClass = req.body.badClass ?? product.badClass;
  product.description = req.body.description ?? product.description;
  product.updatedAt = new Date().toISOString();

  addAudit(db, "UPDATE_PRODUCT", { id: product.id, name: product.name });
  writeDb(db);

  res.json({ ok: true, product });
});

router.patch("/cloud/products/:id/active", (req, res) => {
  const db = readDb();
  const product = findById(db.products, req.params.id);

  if (!product) {
    return res.status(404).json({ ok: false, error: "Producto no encontrado." });
  }

  product.active = Boolean(req.body.active);
  product.updatedAt = new Date().toISOString();

  addAudit(db, product.active ? "ACTIVATE_PRODUCT" : "DEACTIVATE_PRODUCT", {
    id: product.id,
    name: product.name
  });
  writeDb(db);

  res.json({ ok: true, product });
});

router.delete("/cloud/products/:id", (req, res) => {
  const db = readDb();
  const product = findById(db.products, req.params.id);

  if (!product) {
    return res.status(404).json({ ok: false, error: "Producto no encontrado." });
  }

  db.products = db.products.filter((item) => item.id !== req.params.id);
  db.images = db.images.filter((image) => image.productId !== req.params.id);

  addAudit(db, "DELETE_PRODUCT", { id: product.id, name: product.name });
  writeDb(db);

  res.json({ ok: true, deleted: product });
});

/* =========================
   IMAGES / DATASET
========================= */

router.get("/cloud/images", (req, res) => {
  const db = readDb();

  let images = db.images;

  if (req.query.productId) {
    images = images.filter((image) => image.productId === req.query.productId);
  }

  if (req.query.className) {
    images = images.filter((image) => image.className === req.query.className);
  }

  res.json({ ok: true, images });
});

router.post("/cloud/images", upload.single("image"), (req, res) => {
  const db = readDb();

  const productId = req.body.productId;
  const className = req.body.className;

  if (!productId || !className) {
    return res.status(400).json({ ok: false, error: "productId y className son obligatorios." });
  }

  const product = findById(db.products, productId);

  if (!product) {
    return res.status(404).json({ ok: false, error: "Producto no encontrado." });
  }

  if (!req.file) {
    return res.status(400).json({ ok: false, error: "Falta imagen." });
  }

  const relativePath = path.relative(UPLOADS_DIR, req.file.path).replace(/\\/g, "/");

  const image = {
    id: uid("img"),
    productId,
    productName: product.name,
    className,
    originalName: req.file.originalname,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
    relativePath,
    url: `/uploads/${relativePath}`,
    createdAt: new Date().toISOString()
  };

  db.images.unshift(image);
  addAudit(db, "UPLOAD_IMAGE", {
    productId,
    className,
    filename: image.filename
  });
  writeDb(db);

  res.status(201).json({ ok: true, image });
});

router.delete("/cloud/images/:id", (req, res) => {
  const db = readDb();
  const image = findById(db.images, req.params.id);

  if (!image) {
    return res.status(404).json({ ok: false, error: "Imagen no encontrada." });
  }

  const fullPath = path.join(UPLOADS_DIR, image.relativePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  db.images = db.images.filter((item) => item.id !== req.params.id);
  addAudit(db, "DELETE_IMAGE", { id: image.id, filename: image.filename });
  writeDb(db);

  res.json({ ok: true, deleted: image });
});

/* =========================
   SCAN HISTORY
========================= */

router.get("/cloud/scan-history", (req, res) => {
  const db = readDb();
  res.json({ ok: true, scanHistory: db.scanHistory });
});

router.post("/cloud/scan-history", (req, res) => {
  const db = readDb();

  const item = {
    id: uid("scan"),
    product: req.body.product || "desconocido",
    decision: req.body.decision || "REVISAR",
    quality: Number(req.body.quality || 0),
    damage: Number(req.body.damage || 0),
    confidence: Number(req.body.confidence || 0),
    label: req.body.label || "",
    userEmail: req.body.userEmail || "local",
    source: req.body.source || "frontend",
    createdAt: new Date().toISOString()
  };

  db.scanHistory.unshift(item);
  db.scanHistory = db.scanHistory.slice(0, 800);
  writeDb(db);

  res.status(201).json({ ok: true, item });
});

router.delete("/cloud/scan-history", (req, res) => {
  const db = readDb();
  db.scanHistory = [];
  addAudit(db, "CLEAR_SCAN_HISTORY");
  writeDb(db);

  res.json({ ok: true });
});

/* =========================
   HARDWARE CLOUD MODE
   These endpoints keep your existing React App working.
   Instead of calling a local ESP32 IP, commands are queued.
   ESP32 polls AWS/Backend for pending commands.
========================= */

router.post("/hardware/desviar", (req, res) => {
  const command = queueHardwareCommand("SERVO_DESVIAR", {
    delayMs: Number(req.body.delayMs ?? process.env.SERVO_DELAY_MS ?? 4000),
    immediate: Boolean(req.body.immediate),
    reason: req.body.reason || "producto_rechazado",
    product: req.body.product || "desconocido",
    quality: req.body.quality ?? null,
    confidence: req.body.confidence ?? null
  });

  res.json({
    ok: true,
    mode: "cloud-polling",
    queued: true,
    command
  });
});

router.post("/hardware/banda/on", (req, res) => {
  const command = queueHardwareCommand("BANDA_ON", {
    requestedBy: req.body.requestedBy || "frontend"
  });

  res.json({
    ok: true,
    mode: "cloud-polling",
    queued: true,
    command
  });
});

router.post("/hardware/banda/off", (req, res) => {
  const command = queueHardwareCommand("BANDA_OFF", {
    requestedBy: req.body.requestedBy || "frontend"
  });

  res.json({
    ok: true,
    mode: "cloud-polling",
    queued: true,
    command
  });
});

router.get("/hardware/status", (req, res) => {
  const db = readDb();

  const pending = db.hardwareCommands.filter((cmd) => cmd.status === "PENDING").length;
  const delivered = db.hardwareCommands.filter((cmd) => cmd.status === "DELIVERED").length;
  const completed = db.hardwareCommands.filter((cmd) => cmd.status === "DONE").length;

  res.json({
    ok: true,
    mode: "cloud-polling",
    esp32ReachableFromServer: false,
    pending,
    delivered,
    completed
  });
});

/* ESP32 polling endpoints */

router.get("/device/:deviceId/commands/next", (req, res) => {
  const db = readDb();
  const deviceId = req.params.deviceId;

  const command = db.hardwareCommands.find(
    (cmd) =>
      cmd.status === "PENDING" &&
      (!cmd.targetDeviceId || cmd.targetDeviceId === deviceId)
  );

  if (!command) {
    return res.json({ ok: true, hasCommand: false });
  }

  command.status = "DELIVERED";
  command.deliveredAt = new Date().toISOString();

  addAudit(db, "DELIVER_COMMAND_TO_DEVICE", {
    commandId: command.id,
    deviceId,
    type: command.type
  });

  writeDb(db);

  res.json({
    ok: true,
    hasCommand: true,
    command
  });
});

router.post("/device/:deviceId/commands/:commandId/done", (req, res) => {
  const db = readDb();

  const command = findById(db.hardwareCommands, req.params.commandId);

  if (!command) {
    return res.status(404).json({ ok: false, error: "Comando no encontrado." });
  }

  command.status = "DONE";
  command.completedAt = new Date().toISOString();
  command.deviceResponse = req.body || {};

  addAudit(db, "DEVICE_COMMAND_DONE", {
    commandId: command.id,
    deviceId: req.params.deviceId,
    type: command.type
  });

  writeDb(db);

  res.json({
    ok: true,
    command
  });
});

router.get("/cloud/hardware/commands", (req, res) => {
  const db = readDb();
  res.json({
    ok: true,
    commands: db.hardwareCommands.slice().reverse().slice(0, 100)
  });
});

module.exports = router;
