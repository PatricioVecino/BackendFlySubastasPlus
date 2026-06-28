// Cliente WS de prueba: se conecta a la sala 51, escucha 5 segundos, después dispara una puja por HTTP y verifica el broadcast.
require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");

const SID = 51;
const HOST = "localhost";
const PORT = 3001;

function login() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      email: "test@subastasplus.local",
      password: "NuevaPass1",
    });
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: "/v1/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d).token));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function ingresarSala(token) {
  return new Promise((resolve, reject) => {
    http
      .request(
        {
          host: HOST,
          port: PORT,
          path: `/v1/subastas/${SID}/sala`,
          method: "GET",
          headers: { Authorization: "Bearer " + token },
        },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(JSON.parse(d)));
        },
      )
      .on("error", reject)
      .end();
  });
}

function puja(token, monto) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ monto });
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: `/v1/subastas/${SID}/pujas`,
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

(async () => {
  const token = await login();
  console.log("✓ login");

  const sala = await ingresarSala(token);
  console.log("✓ ingresarSala, mejorOferta=", sala.piezaActual?.mejorOferta);

  const ws = new WebSocket(
    `ws://${HOST}:${PORT}/v1/realtime/subastas/${SID}?token=${token}`,
  );

  ws.on("open", () => console.log("✓ WS conectado"));
  ws.on("message", (m) => {
    const ev = JSON.parse(m.toString());
    console.log("← WS:", JSON.stringify(ev));
  });
  ws.on("close", () => console.log("× WS cerrado"));
  ws.on("error", (e) => console.log("× WS error:", e.message));

  await new Promise((r) => setTimeout(r, 1500));

  const minimo = sala.piezaActual.pujaMinima;
  console.log(`→ POST puja ${minimo}...`);
  const r = await puja(token, minimo);
  console.log("← HTTP:", r.status, r.body.slice(0, 200));

  await new Promise((r) => setTimeout(r, 1500));
  ws.close();
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
