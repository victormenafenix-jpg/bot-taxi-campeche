// bot_seguro.js - VERSIÓN SEGURA PARA LA NUBE
const express = require("express");
const twilio = require("twilio");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// VARIABLES SEGURAS
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
    console.error("ERROR: Falta configurar Twilio en Render.com");
    process.exit(1);
}

const client = twilio(accountSid, authToken);
const db = new Database("taxi_notificaciones.db");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Bot de Taxis Campeche funcionando");
});

app.post("/whatsapp-webhook", (req, res) => {
    console.log("Mensaje recibido");
    res.status(200).send("OK");
});

app.listen(PORT, () => {
    console.log("Bot activo en puerto " + PORT);
});