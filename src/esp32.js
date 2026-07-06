export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
export const DELAY_CAMARA_A_SERVO = Number(import.meta.env.VITE_DELAY_SERVO_MS || 4000);

async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
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
    console.error(`[API] Error conectando con ${API_URL}${endpoint}:`, error);
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

export async function verificarESP32() {
  const result = await apiRequest("/api/hardware/status");
  return result.ok;
}

export async function encenderBanda() {
  return apiRequest("/api/hardware/banda/on", {
    method: "POST",
    body: JSON.stringify({ requestedBy: "frontend" })
  });
}

export async function apagarBanda() {
  return apiRequest("/api/hardware/banda/off", {
    method: "POST",
    body: JSON.stringify({ requestedBy: "frontend" })
  });
}

export async function desviarFruta(payload = {}) {
  return apiRequest("/api/hardware/desviar", {
    method: "POST",
    body: JSON.stringify({
      delayMs: DELAY_CAMARA_A_SERVO,
      immediate: false,
      reason: payload.reason || "producto_rechazado",
      product: payload.product || "desconocido",
      quality: payload.quality ?? null
    })
  });
}

export async function desviarInmediato(payload = {}) {
  return apiRequest("/api/hardware/desviar", {
    method: "POST",
    body: JSON.stringify({
      delayMs: 0,
      immediate: true,
      reason: payload.reason || "prueba_manual",
      product: payload.product || "manual",
      quality: payload.quality ?? null
    })
  });
}

export async function registrarResultadoAnalisis(resultado = {}) {
  return apiRequest("/api/scan/result", {
    method: "POST",
    body: JSON.stringify({
      product: resultado.product || "desconocido",
      decision: resultado.decision || "REVISAR",
      quality: resultado.quality || 0,
      damage: resultado.damage || 0,
      confidence: resultado.confidence || 0,
      userEmail: resultado.userEmail || "local",
      source: "frontend"
    })
  });
}