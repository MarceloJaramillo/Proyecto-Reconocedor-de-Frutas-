// Dirección IP del ESP32 en la red local — cambiar según la red
export const ESP32_IP = "10.236.170.78";

// Tiempo en ms entre que la cámara detecta una fruta rechazada
// y que el servo se activa (da tiempo a que la fruta llegue al desvío)
export const DELAY_CAMARA_A_SERVO = 4000;

// Verifica si el ESP32 está disponible en la red. Timeout de 3 segundos.
export async function verificarESP32() {
  console.log("[ESP32] Verificando conexión con", ESP32_IP);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://${ESP32_IP}/estado`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    console.log("[ESP32] Disponible:", data);
    return true;
  } catch (err) {
    console.error("[ESP32] No disponible:", err.message);
    return false;
  }
}

// Enciende el motor de la banda transportadora
export async function encenderBanda() {
  console.log("[ESP32] Encendiendo banda...");
  try {
    const response = await fetch(`http://${ESP32_IP}/banda/on`);
    const data = await response.json();
    console.log("[ESP32] Banda encendida:", data);
  } catch (err) {
    console.error("[ESP32] Error al encender banda:", err.message);
  }
}

// Apaga el motor de la banda transportadora
export async function apagarBanda() {
  console.log("[ESP32] Apagando banda...");
  try {
    const response = await fetch(`http://${ESP32_IP}/banda/off`);
    const data = await response.json();
    console.log("[ESP32] Banda apagada:", data);
  } catch (err) {
    console.error("[ESP32] Error al apagar banda:", err.message);
  }
}

// Espera DELAY_CAMARA_A_SERVO ms y luego activa el servo de desvío.
// Se llama sin await (fire-and-forget) cuando se detecta una fruta rechazada.
export async function desviarFruta() {
  console.log(`[ESP32] Esperando ${DELAY_CAMARA_A_SERVO}ms para que la fruta avance...`);
  await new Promise((resolve) => setTimeout(resolve, DELAY_CAMARA_A_SERVO));
  console.log("[ESP32] Desviando fruta defectuosa...");
  try {
    const response = await fetch(`http://${ESP32_IP}/desviar`, { method: "POST" });
    const data = await response.json();
    console.log("[ESP32] Servo activado:", data);
  } catch (err) {
    console.error("[ESP32] Error al desviar fruta:", err.message);
  }
}

// Activa el servo inmediatamente sin delay (para pruebas manuales)
export async function desviarInmediato() {
  console.log("[ESP32] Activando servo (prueba manual)...");
  try {
    const response = await fetch(`http://${ESP32_IP}/desviar`, { method: "POST" });
    const data = await response.json();
    console.log("[ESP32] Servo activado (manual):", data);
  } catch (err) {
    console.error("[ESP32] Error al activar servo:", err.message);
  }
}
