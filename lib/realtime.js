const url = require("url");
const WebSocket = require("ws");
const tokens = require("./tokens");
const supabase = require("../supabase-client");

// Map<subastaId, Set<WebSocket>>
const rooms = new Map();

function joinRoom(id, ws) {
  if (!rooms.has(id)) rooms.set(id, new Set());
  rooms.get(id).add(ws);
}

function leaveRoom(id, ws) {
  const r = rooms.get(id);
  if (!r) return;
  r.delete(ws);
  if (r.size === 0) rooms.delete(id);
}

function roomSize(id) {
  return rooms.get(Number(id))?.size || 0;
}

function broadcast(id, payload) {
  const r = rooms.get(Number(id));
  if (!r) return;
  const msg = JSON.stringify(payload);
  for (const ws of r) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function attachRealtime(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const parsed = url.parse(req.url, true);
    const m = parsed.pathname && parsed.pathname.match(/^\/v1\/realtime\/subastas\/(\d+)\/?$/);
    if (!m) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const subastaId = Number(m[1]);

    const token = parsed.query.token;
    let user;
    try {
      user = tokens.verify(token, "access");
    } catch (_) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.subastaId = subastaId;
      ws.userSub = user.sub;
      joinRoom(subastaId, ws);

      ws.send(
        JSON.stringify({
          event: "bienvenida",
          subastaId,
          conectados: roomSize(subastaId),
        }),
      );
      broadcast(subastaId, { event: "conectados", count: roomSize(subastaId) });

      ws.on("close", async () => {
        leaveRoom(subastaId, ws);
        broadcast(subastaId, { event: "conectados", count: roomSize(subastaId) });
        try {
          const { data: asistente } = await supabase
            .from("asistentes")
            .select("identificador")
            .eq("cliente", ws.userSub)
            .eq("subasta", subastaId)
            .maybeSingle();
          if (asistente) {
            await supabase
              .from("asistentes_extension")
              .update({ estado_conexion: "desconectado" })
              .eq("asistente", asistente.identificador);
          }
        } catch (_) {}
      });
      ws.on("error", () => leaveRoom(subastaId, ws));
    });
  });

  return wss;
}

module.exports = { attachRealtime, broadcast, roomSize };
