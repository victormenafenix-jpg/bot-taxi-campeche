// bot_final_corregido.js - VERSIÓN CORREGIDA Y FUNCIONAL
const express = require("express");
const twilio = require("twilio");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3000;
const accountSid = "AC55dde1eebad7cb54b6f7a73632f6bf94";
const authToken = "dbc10286837d09f86453524bea113f3f";
const client = twilio(accountSid, authToken);
const db = new Database("taxi_notificaciones.db");

app.use(express.urlencoded({ extended: true }));

// Estados del usuario
const userStates = new Map();

// Función para enviar mensajes WhatsApp
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

// Guardar viaje en BD
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

// Webhook principal
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
    res.send("🚕 Bot Taxi Campeche - VERSION FINAL CORREGIDA");
});

app.listen(PORT, () => {
    console.log("=".repeat(60));
    console.log("🚀 BOT FINAL CORREGIDO - INICIADO");
    console.log(`📡 Puerto: ${PORT}`);
    console.log("👉 Envia 'hola' al bot para probar");
    console.log("=".repeat(60));
});
