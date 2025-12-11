// bot_con_notificaciones.js - CON NOTIFICACIONES A TAXISTAS
const express = require("express");
const twilio = require("twilio");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3000;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);
const db = new Database("taxi_notificaciones.db");

// ==== CREACIÓN DE TABLA servicios (PARA RENDER) ====
db.exec("CREATE TABLE IF NOT EXISTS servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL,
    cliente_nombre TEXT,
    telefono TEXT,
    origen TEXT,
    destino TEXT,
    precio REAL,
    confirmado INTEGER DEFAULT 0,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)");
console.log("✅ Tabla 'servicios' lista");

app.use(express.urlencoded({ extended: true }));

// Estados del usuario
const userStates = new Map();

// ========== FUNCIONES ==========
// 1. Enviar mensajes WhatsApp
async function enviarWhatsApp(to, message) {
    try {
        await client.messages.create({
            body: message,
            from: "whatsapp:+14155238886",
            to: to
        });
        console.log(`[RESPUESTA ENVIADA] a ${to}`);
        return true;
    } catch (error) {
        console.error(`[ERROR] Enviando: ${error.message}`);
        return false;
    }
}

// 2. Guardar viaje en BD
function guardarViajeBD(clienteNumero, origen, destinoTexto) {
    const esAeropuerto = destinoTexto.toLowerCase().includes("aeropuerto");
    const precio = esAeropuerto ? 95 : 50;
    
    const stmt = db.prepare(`
        INSERT INTO servicios 
        (cliente_nombre, cliente_telefono, origen, destino, precio, estado)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const info = stmt.run(
        "Cliente WhatsApp",
        clienteNumero.replace("whatsapp:", ""),
        `Lat: ${origen.lat}, Lon: ${origen.lon}`,
        destinoTexto.toUpperCase(),
        precio,
        "pendiente"
    );
    
    return { id: info.lastInsertRowid, precio };
}

// 3. NOTIFICAR A TAXISTAS (NUEVA FUNCIÓN)
async function notificarTaxistas(viajeId, destino, precio) {
    try {
        console.log(`[NOTIFICANDO] Taxistas sobre viaje #${viajeId}...`);
        
        // Buscar taxistas disponibles
        const taxistas = db.prepare(
            "SELECT telefono, nombre FROM taxistas WHERE estado IN ('disponible', 'activo')"
        ).all();
        
        if (taxistas.length === 0) {
            console.log("[AVISO] No hay taxistas disponibles");
            return;
        }
        
        console.log(`[ENCONTRADOS] ${taxistas.length} taxistas`);
        
        for (const taxista of taxistas) {
            try {
                // Formatear teléfono para WhatsApp
                let telefonoWhatsApp = taxista.telefono;
                if (!telefonoWhatsApp.startsWith("whatsapp:")) {
                    telefonoWhatsApp = `whatsapp:${telefonoWhatsApp}`;
                }
                
                await client.messages.create({
                    body: `🚕 NUEVO VIAJE #${viajeId}\nDestino: ${destino}\nPrecio: $${precio}\nHora: ${new Date().toLocaleTimeString()}\nPara aceptar, responde: ACEPTAR ${viajeId}`,
                    from: "whatsapp:+14155238886",
                    to: telefonoWhatsApp
                });
                
                console.log(`   [NOTIFICADO] ${taxista.nombre} (${taxista.telefono})`);
                
            } catch (error) {
                console.error(`   [ERROR] Notificando ${taxista.nombre}:`, error.message);
            }
        }
        
        console.log("[COMPLETADO] Notificaciones enviadas");
        
    } catch (error) {
        console.error("[ERROR CRITICO] en notificarTaxistas:", error.message);
    }
}

// ========== WEBHOOK PRINCIPAL ==========
app.post("/whatsapp-webhook", async (req, res) => {
    console.log(`\n[MENSAJE RECIBIDO] de ${req.body.From}: ${req.body.Body || "(ubicacion)"}`);
    
    try {
        const from = req.body.From;
        const message = req.body.Body ? req.body.Body.trim() : "";
        const lat = req.body.Latitude;
        const lon = req.body.Longitude;
        
        // Inicializar estado
        if (!userStates.has(from)) {
            userStates.set(from, { estado: "menu", datos: {} });
        }
        
        const userState = userStates.get(from);
        const msg = message.toLowerCase();
        
        // Comando CANCELAR
        if (msg === "cancelar") {
            userStates.set(from, { estado: "menu", datos: {} });
            await enviarWhatsApp(from, "❌ Solicitud cancelada. Escribe 'hola' para comenzar.");
            return res.sendStatus(200);
        }
        
        // Procesar según estado
        switch(userState.estado) {
            case "menu":
                if (msg === "hola" || msg === "hi") {
                    await enviarWhatsApp(from,
                        "🚕 *TAXI CAMPECHE*\n\n" +
                        "1. SOLICITAR TAXI\n" +
                        "2. CONSULTAR TARIFAS\n" +
                        "3. CONTACTO\n\n" +
                        "Responde con el numero (1-3)"
                    );
                }
                else if (msg === "1") {
                    userState.estado = "esperando_ubicacion";
                    await enviarWhatsApp(from,
                        "🚖 *SOLICITAR TAXI*\n\n" +
                        "Por favor, comparte tu ubicacion:\n" +
                        "1. Toca el clip 📎\n" +
                        "2. 'Ubicacion'\n" +
                        "3. Comparte ubicacion actual\n\n" +
                        "O escribe CANCELAR"
                    );
                }
                else if (msg === "2") {
                    await enviarWhatsApp(from,
                        "💰 *TARIFAS*\n\n" +
                        "• Centro: $30-40\n" +
                        "• Aeropuerto: $95 (incluye $15 comision)\n" +
                        "• Por km adicional: $15\n\n" +
                        "Escribe 'hola' para volver al menu."
                    );
                }
                else if (msg === "3") {
                    await enviarWhatsApp(from,
                        "📞 *CONTACTO*\n\n" +
                        "• WhatsApp: este numero\n" +
                        "• Telefono: 981 123 4567\n\n" +
                        "Escribe 'hola' para volver."
                    );
                }
                break;
                
            case "esperando_ubicacion":
                if (lat && lon) {
                    userState.datos.origen = { lat, lon };
                    userState.estado = "esperando_destino";
                    
                    console.log(`[UBICACION GUARDADA] para ${from}: lat=${lat}, lon=${lon}`);
                    
                    await enviarWhatsApp(from,
                        "📍 *Ubicacion recibida* ✅\n\n" +
                        "Ahora escribe tu *DESTINO*\n" +
                        "(Ejemplo: Aeropuerto, Centro, Hotel Baluartes)\n\n" +
                        "O escribe CANCELAR"
                    );
                } else {
                    await enviarWhatsApp(from, "📍 Por favor, comparte tu ubicacion usando el clip 📎");
                }
                break;
                
            case "esperando_destino":
                if (message) {
                    userState.datos.destino = message;
                    userState.estado = "esperando_confirmacion";
                    
                    const precio = message.toLowerCase().includes("aeropuerto") ? 95 : 50;
                    const comision = message.toLowerCase().includes("aeropuerto") ? 15 : 10;
                    
                    await enviarWhatsApp(from,
                        `📍 *Destino: ${message.toUpperCase()}*\n\n` +
                        `🚕 *COTIZACION:*\n` +
                        `• Viaje a ${message}: $${precio - comision}\n` +
                        `• Comision servicio: $${comision}\n` +
                        `• *TOTAL: $${precio}*\n\n` +
                        `Para confirmar escribe: CONFIRMAR\n` +
                        `O: CANCELAR`
                    );
                }
                break;
                
            case "esperando_confirmacion":
                if (msg === "confirmar") {
                    const viaje = guardarViajeBD(from, userState.datos.origen, userState.datos.destino);
                    
                    console.log(`[VIAJE CONFIRMADO] #${viaje.id} por ${from}`);
                    
                    // ✅ NOTIFICAR A TAXISTAS (NUEVO)
                    await notificarTaxistas(viaje.id, userState.datos.destino.toUpperCase(), viaje.precio);
                    
                    await enviarWhatsApp(from,
                        `✅ *TAXI CONFIRMADO* #${viaje.id}\n\n` +
                        `📋 *Detalles:*\n` +
                        `• Origen: Ubicacion recibida ✓\n` +
                        `• Destino: ${userState.datos.destino.toUpperCase()}\n` +
                        `• Precio total: $${viaje.precio}\n\n` +
                        `🚕 Un taxista sera asignado en breve.\n` +
                        `📱 Te notificaremos por este chat.`
                    );
                    
                    // Resetear estado
                    userStates.set(from, { estado: "menu", datos: {} });
                } else {
                    await enviarWhatsApp(from, "Escribe CONFIRMAR para solicitar el taxi o CANCELAR para salir.");
                }
                break;
        }
        
        res.sendStatus(200);
        
    } catch (error) {
        console.error("[ERROR CRITICO]:", error.message);
        res.sendStatus(500);
    }
});

app.get("/", (req, res) => {
    res.send("🚕 Bot Taxi Campeche - CON NOTIFICACIONES A TAXISTAS");
});

app.listen(PORT, () => {
    console.log("=".repeat(60));
    console.log("🚀 BOT CON NOTIFICACIONES - INICIADO");
    console.log(`📡 Puerto: ${PORT}`);
    console.log("👉 Envia 'hola' al bot para probar");
    console.log("👉 Los taxistas recibiran notificaciones de nuevos viajes");
    console.log("=".repeat(60));
});


