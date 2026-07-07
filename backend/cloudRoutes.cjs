const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

try {
  require("dotenv").config();
} catch (error) {
  // Si dotenv no está instalado, se usarán las variables de entorno del sistema.
}

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand
} = require("@aws-sdk/lib-dynamodb");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || "agro-quality-ai-dataset-marcelo";

const TABLES = {
  users: process.env.DYNAMO_USERS_TABLE || "AgroUsers",
  products: process.env.DYNAMO_PRODUCTS_TABLE || "AgroProducts",
  images: process.env.DYNAMO_IMAGES_TABLE || "AgroImages",
  scanHistory: process.env.DYNAMO_SCAN_HISTORY_TABLE || "AgroScanHistory",
  hardwareCommands: process.env.DYNAMO_HARDWARE_COMMANDS_TABLE || "AgroHardwareCommands"
};

const DEFAULT_ADMIN = {
  email: "admin@smartvision.com",
  id: "admin@smartvision.com",
  name: "Administrador Principal",
  role: "Administrador",
  active: true,
  protected: true,
  provider: "Sistema",
  createdAt: "Inicial"
};

const DEFAULT_USERS = [
  DEFAULT_ADMIN,
  {
    email: "operador@smartvision.com",
    id: "operador@smartvision.com",
    name: "Usuario Operador",
    role: "Usuario",
    active: true,
    protected: false,
    provider: "Sistema",
    createdAt: "Inicial"
  }
];

const DEFAULT_PRODUCTS = [
  {
    productId: "palta",
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
    productId: "mango",
    id: "mango",
    name: "Mango",
    slug: "mango",
    icon: "🥭",
    active: true,
    accepted: true,
    goodClass: "mango_bueno",
    badClass: "mango_malo",
    description: "Producto agrícola aceptado por el sistema."
  },
  {
    productId: "jengibre",
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
    productId: "curcuma",
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
];

const s3 = new S3Client({ region: AWS_REGION });
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: AWS_REGION }),
  {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true
    }
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (!ok) return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP."));
    cb(null, true);
  }
});

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
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

function decodeKey(value = "") {
  return decodeURIComponent(String(value));
}

function sanitizeFilename(filename = "imagen.jpg") {
  const ext = path.extname(filename).toLowerCase() || ".jpg";
  const base = path
    .basename(filename, ext)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "imagen";

  return `${base}${ext}`;
}

async function scanAll(TableName) {
  let Items = [];
  let ExclusiveStartKey = undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName,
        ExclusiveStartKey
      })
    );

    Items = Items.concat(result.Items || []);
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return Items;
}

async function getItem(TableName, Key) {
  const result = await dynamo.send(new GetCommand({ TableName, Key }));
  return result.Item || null;
}

async function putItem(TableName, Item) {
  await dynamo.send(new PutCommand({ TableName, Item }));
  return Item;
}

async function deleteItem(TableName, Key) {
  await dynamo.send(new DeleteCommand({ TableName, Key }));
}

function cleanUser(user) {
  const email = normalizeEmail(user.email);

  return {
    email,
    id: email,
    name: String(user.name || "").trim(),
    role: user.role === "Administrador" ? "Administrador" : "Usuario",
    active: user.protected ? true : Boolean(user.active),
    protected: Boolean(user.protected),
    provider: user.provider || "Manual",
    photoURL: user.photoURL || "",
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || null
  };
}

function cleanProduct(product) {
  const name = String(product.name || "").trim();
  const productId = normalizeSlug(product.productId || product.id || product.slug || name);

  return {
    productId,
    id: productId,
    name,
    slug: productId,
    icon: product.icon || "🌱",
    active: product.active ?? true,
    accepted: product.accepted ?? true,
    goodClass: product.goodClass || `${productId}_buena`,
    badClass: product.badClass || `${productId}_mala`,
    description: product.description || "",
    createdAt: product.createdAt || nowIso(),
    updatedAt: product.updatedAt || null
  };
}

async function getSignedImageUrl(s3Key) {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: s3Key
  });

  return getSignedUrl(s3, command, { expiresIn: 60 * 60 });
}

async function enrichImage(image) {
  return {
    ...image,
    id: image.id || image.imageId,
    url: image.s3Key ? await getSignedImageUrl(image.s3Key) : ""
  };
}

async function seedDefaults() {
  for (const user of DEFAULT_USERS) {
    const exists = await getItem(TABLES.users, { email: user.email });
    if (!exists) await putItem(TABLES.users, cleanUser(user));
  }

  for (const product of DEFAULT_PRODUCTS) {
    const exists = await getItem(TABLES.products, { productId: product.productId });
    if (!exists) await putItem(TABLES.products, cleanProduct(product));
  }
}

let seedPromise = seedDefaults().catch((error) => {
  console.error("Error inicializando DynamoDB:", error);
});

async function ensureSeeded(req, res, next) {
  try {
    await seedPromise;
    next();
  } catch (error) {
    next(error);
  }
}

router.use(ensureSeeded);

/* =========================
   HEALTH
========================= */

router.get("/cloud/health", async (req, res, next) => {
  try {
    const [users, products, images, scans, commands] = await Promise.all([
      scanAll(TABLES.users),
      scanAll(TABLES.products),
      scanAll(TABLES.images),
      scanAll(TABLES.scanHistory),
      scanAll(TABLES.hardwareCommands)
    ]);

    res.json({
      ok: true,
      service: "Agro Quality AI AWS API",
      mode: "dynamodb-s3",
      region: AWS_REGION,
      bucket: S3_BUCKET_NAME,
      tables: TABLES,
      totals: {
        users: users.length,
        products: products.length,
        images: images.length,
        scanHistory: scans.length,
        pendingCommands: commands.filter((cmd) => cmd.status === "PENDING").length
      }
    });
  } catch (error) {
    next(error);
  }
});

/* =========================
   USERS
========================= */

router.get("/cloud/users", async (req, res, next) => {
  try {
    const users = await scanAll(TABLES.users);
    users.sort((a, b) => String(a.email).localeCompare(String(b.email)));
    res.json({ ok: true, users });
  } catch (error) {
    next(error);
  }
});

router.post("/cloud/users", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || "").trim();

    if (!email || !name) {
      return res.status(400).json({ ok: false, error: "Nombre y correo son obligatorios." });
    }

    const exists = await getItem(TABLES.users, { email });
    if (exists) {
      return res.status(409).json({ ok: false, error: "El usuario ya existe." });
    }

    const user = cleanUser({
      email,
      name,
      role: req.body.role || "Usuario",
      active: req.body.active ?? true,
      provider: req.body.provider || "Manual",
      protected: false
    });

    await putItem(TABLES.users, user);
    res.status(201).json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

router.put("/cloud/users/:id", async (req, res, next) => {
  try {
    const currentEmail = normalizeEmail(decodeKey(req.params.id));
    const current = await getItem(TABLES.users, { email: currentEmail });

    if (!current) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado." });
    }

    if (current.protected) {
      const updatedProtected = {
        ...current,
        name: req.body.name || current.name,
        role: "Administrador",
        active: true,
        protected: true,
        updatedAt: nowIso()
      };

      await putItem(TABLES.users, updatedProtected);
      return res.json({ ok: true, user: updatedProtected });
    }

    const newEmail = normalizeEmail(req.body.email ?? current.email);

    if (newEmail !== currentEmail) {
      const exists = await getItem(TABLES.users, { email: newEmail });
      if (exists) {
        return res.status(409).json({ ok: false, error: "El nuevo correo ya existe." });
      }
      await deleteItem(TABLES.users, { email: currentEmail });
    }

    const updated = cleanUser({
      ...current,
      email: newEmail,
      name: req.body.name ?? current.name,
      role: req.body.role ?? current.role,
      active: req.body.active ?? current.active,
      updatedAt: nowIso()
    });

    await putItem(TABLES.users, updated);
    res.json({ ok: true, user: updated });
  } catch (error) {
    next(error);
  }
});

router.patch("/cloud/users/:id/active", async (req, res, next) => {
  try {
    const email = normalizeEmail(decodeKey(req.params.id));
    const user = await getItem(TABLES.users, { email });

    if (!user) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado." });
    }

    if (user.protected) {
      return res.status(400).json({
        ok: false,
        error: "El administrador principal no se puede desactivar."
      });
    }

    const updated = {
      ...user,
      active: Boolean(req.body.active),
      updatedAt: nowIso()
    };

    await putItem(TABLES.users, updated);
    res.json({ ok: true, user: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/cloud/users/:id", async (req, res, next) => {
  try {
    const email = normalizeEmail(decodeKey(req.params.id));
    const user = await getItem(TABLES.users, { email });

    if (!user) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado." });
    }

    if (user.protected) {
      return res.status(400).json({
        ok: false,
        error: "El administrador principal no se puede eliminar."
      });
    }

    await deleteItem(TABLES.users, { email });
    res.json({ ok: true, deleted: user });
  } catch (error) {
    next(error);
  }
});

/* =========================
   PRODUCTS
========================= */

router.get("/cloud/products", async (req, res, next) => {
  try {
    const products = await scanAll(TABLES.products);
    products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({ ok: true, products });
  } catch (error) {
    next(error);
  }
});

router.post("/cloud/products", async (req, res, next) => {
  try {
    const product = cleanProduct(req.body);

    if (!product.name || !product.productId) {
      return res.status(400).json({ ok: false, error: "Nombre del producto es obligatorio." });
    }

    const exists = await getItem(TABLES.products, { productId: product.productId });
    if (exists) {
      return res.status(409).json({ ok: false, error: "El producto ya existe." });
    }

    await putItem(TABLES.products, product);
    res.status(201).json({ ok: true, product });
  } catch (error) {
    next(error);
  }
});

router.put("/cloud/products/:id", async (req, res, next) => {
  try {
    const productId = normalizeSlug(decodeKey(req.params.id));
    const current = await getItem(TABLES.products, { productId });

    if (!current) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado." });
    }

    const updated = {
      ...current,
      name: req.body.name ?? current.name,
      icon: req.body.icon ?? current.icon,
      active: req.body.active ?? current.active,
      accepted: req.body.accepted ?? current.accepted,
      goodClass: req.body.goodClass ?? current.goodClass,
      badClass: req.body.badClass ?? current.badClass,
      description: req.body.description ?? current.description,
      updatedAt: nowIso()
    };

    await putItem(TABLES.products, updated);
    res.json({ ok: true, product: updated });
  } catch (error) {
    next(error);
  }
});

router.patch("/cloud/products/:id/active", async (req, res, next) => {
  try {
    const productId = normalizeSlug(decodeKey(req.params.id));
    const product = await getItem(TABLES.products, { productId });

    if (!product) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado." });
    }

    const updated = {
      ...product,
      active: Boolean(req.body.active),
      updatedAt: nowIso()
    };

    await putItem(TABLES.products, updated);
    res.json({ ok: true, product: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/cloud/products/:id", async (req, res, next) => {
  try {
    const productId = normalizeSlug(decodeKey(req.params.id));
    const product = await getItem(TABLES.products, { productId });

    if (!product) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado." });
    }

    await deleteItem(TABLES.products, { productId });
    res.json({ ok: true, deleted: product });
  } catch (error) {
    next(error);
  }
});

/* =========================
   IMAGES / S3
========================= */

router.get("/cloud/images", async (req, res, next) => {
  try {
    let images = await scanAll(TABLES.images);

    if (req.query.productId) {
      images = images.filter((image) => image.productId === req.query.productId);
    }

    if (req.query.className) {
      images = images.filter((image) => image.className === req.query.className);
    }

    images.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const enriched = await Promise.all(images.map(enrichImage));

    res.json({ ok: true, images: enriched });
  } catch (error) {
    next(error);
  }
});

router.post("/cloud/images", upload.single("image"), async (req, res, next) => {
  try {
    const productId = normalizeSlug(req.body.productId);
    const className = normalizeSlug(req.body.className);

    if (!productId || !className) {
      return res.status(400).json({
        ok: false,
        error: "productId y className son obligatorios."
      });
    }

    const product = await getItem(TABLES.products, { productId });

    if (!product) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado." });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Falta imagen." });
    }

    const imageId = uid("img");
    const cleanName = sanitizeFilename(req.file.originalname);
    const s3Key = `dataset/${productId}/${className}/${imageId}_${cleanName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: {
          productId,
          className
        }
      })
    );

    const image = {
      imageId,
      id: imageId,
      productId,
      productName: product.name,
      className,
      originalName: req.file.originalname,
      filename: cleanName,
      mimeType: req.file.mimetype,
      size: req.file.size,
      s3Bucket: S3_BUCKET_NAME,
      s3Key,
      createdAt: nowIso()
    };

    await putItem(TABLES.images, image);

    res.status(201).json({
      ok: true,
      image: await enrichImage(image)
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/cloud/images/:id", async (req, res, next) => {
  try {
    const imageId = decodeKey(req.params.id);
    const image = await getItem(TABLES.images, { imageId });

    if (!image) {
      return res.status(404).json({ ok: false, error: "Imagen no encontrada." });
    }

    if (image.s3Key) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: image.s3Bucket || S3_BUCKET_NAME,
          Key: image.s3Key
        })
      );
    }

    await deleteItem(TABLES.images, { imageId });

    res.json({ ok: true, deleted: image });
  } catch (error) {
    next(error);
  }
});

/* =========================
   SCAN HISTORY
========================= */

router.get("/cloud/scan-history", async (req, res, next) => {
  try {
    const scanHistory = await scanAll(TABLES.scanHistory);
    scanHistory.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ ok: true, scanHistory });
  } catch (error) {
    next(error);
  }
});

router.post("/cloud/scan-history", async (req, res, next) => {
  try {
    const scanId = uid("scan");

    const item = {
      scanId,
      id: scanId,
      product: req.body.product || "desconocido",
      decision: req.body.decision || "REVISAR",
      quality: Number(req.body.quality || 0),
      damage: Number(req.body.damage || 0),
      confidence: Number(req.body.confidence || 0),
      label: req.body.label || "",
      userEmail: req.body.userEmail || "local",
      source: req.body.source || "frontend",
      createdAt: nowIso()
    };

    await putItem(TABLES.scanHistory, item);
    res.status(201).json({ ok: true, item });
  } catch (error) {
    next(error);
  }
});

router.delete("/cloud/scan-history", async (req, res, next) => {
  try {
    const items = await scanAll(TABLES.scanHistory);

    await Promise.all(
      items.map((item) => deleteItem(TABLES.scanHistory, { scanId: item.scanId }))
    );

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   HARDWARE COMMANDS
========================= */

async function queueHardwareCommand(type, payload = {}) {
  const commandId = uid("cmd");

  const command = {
    commandId,
    id: commandId,
    type,
    payload,
    status: "PENDING",
    targetDeviceId: payload.deviceId || process.env.ESP32_DEVICE_ID || "esp32-principal",
    createdAt: nowIso(),
    deliveredAt: null,
    completedAt: null
  };

  await putItem(TABLES.hardwareCommands, command);
  return command;
}

router.post("/hardware/desviar", async (req, res, next) => {
  try {
    const command = await queueHardwareCommand("SERVO_DESVIAR", {
      delayMs: Number(req.body.delayMs ?? process.env.SERVO_DELAY_MS ?? 4000),
      immediate: Boolean(req.body.immediate),
      reason: req.body.reason || "producto_rechazado",
      product: req.body.product || "desconocido",
      quality: req.body.quality ?? null,
      confidence: req.body.confidence ?? null
    });

    res.json({
      ok: true,
      mode: "dynamodb-s3",
      queued: true,
      command
    });
  } catch (error) {
    next(error);
  }
});

router.post("/hardware/banda/on", async (req, res, next) => {
  try {
    const command = await queueHardwareCommand("BANDA_ON", {
      requestedBy: req.body.requestedBy || "frontend"
    });

    res.json({ ok: true, mode: "dynamodb-s3", queued: true, command });
  } catch (error) {
    next(error);
  }
});

router.post("/hardware/banda/off", async (req, res, next) => {
  try {
    const command = await queueHardwareCommand("BANDA_OFF", {
      requestedBy: req.body.requestedBy || "frontend"
    });

    res.json({ ok: true, mode: "dynamodb-s3", queued: true, command });
  } catch (error) {
    next(error);
  }
});

router.get("/hardware/status", async (req, res, next) => {
  try {
    const commands = await scanAll(TABLES.hardwareCommands);

    res.json({
      ok: true,
      mode: "dynamodb-s3",
      esp32ReachableFromServer: false,
      pending: commands.filter((cmd) => cmd.status === "PENDING").length,
      delivered: commands.filter((cmd) => cmd.status === "DELIVERED").length,
      completed: commands.filter((cmd) => cmd.status === "DONE").length
    });
  } catch (error) {
    next(error);
  }
});

router.get("/device/:deviceId/commands/next", async (req, res, next) => {
  try {
    const deviceId = req.params.deviceId;
    const commands = await scanAll(TABLES.hardwareCommands);

    const pending = commands
      .filter(
        (cmd) =>
          cmd.status === "PENDING" &&
          (!cmd.targetDeviceId || cmd.targetDeviceId === deviceId)
      )
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    const command = pending[0];

    if (!command) {
      return res.json({ ok: true, hasCommand: false });
    }

    const delivered = {
      ...command,
      status: "DELIVERED",
      deliveredAt: nowIso()
    };

    await putItem(TABLES.hardwareCommands, delivered);

    res.json({
      ok: true,
      hasCommand: true,
      command: delivered
    });
  } catch (error) {
    next(error);
  }
});

router.post("/device/:deviceId/commands/:commandId/done", async (req, res, next) => {
  try {
    const commandId = decodeKey(req.params.commandId);
    const command = await getItem(TABLES.hardwareCommands, { commandId });

    if (!command) {
      return res.status(404).json({ ok: false, error: "Comando no encontrado." });
    }

    const updated = {
      ...command,
      status: "DONE",
      completedAt: nowIso(),
      deviceResponse: req.body || {}
    };

    await putItem(TABLES.hardwareCommands, updated);

    res.json({ ok: true, command: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/cloud/hardware/commands", async (req, res, next) => {
  try {
    const commands = await scanAll(TABLES.hardwareCommands);
    commands.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ ok: true, commands: commands.slice(0, 100) });
  } catch (error) {
    next(error);
  }
});

/* =========================
   ERROR HANDLER
========================= */

router.use((error, req, res, next) => {
  console.error("AWS route error:", error);

  res.status(error.statusCode || 500).json({
    ok: false,
    error: error.message || "Error interno en rutas AWS."
  });
});

module.exports = router;
