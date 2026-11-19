const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const rooms = new Map();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(socket, payload) {
  if (socket.destroyed || !socket.writable) return;
  const data = Buffer.from(JSON.stringify(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  socket.write(Buffer.concat([header, data]));
}

function sendError(socket, message) {
  send(socket, { type: "error", message });
}

function sendState(room) {
  for (const player of room.players) {
    if (!player) continue;
    const opponent = room.players.find((candidate) => candidate && candidate.id !== player.id);
    send(player.socket, {
      type: "state",
      roomCode: room.code,
      playerId: player.id,
      playerCount: room.players.filter(Boolean).length,
      ownReady: Boolean(player.secret),
      opponentReady: Boolean(opponent && opponent.secret),
      status: room.status,
      turn: room.turn,
      winner: room.winner,
      history: room.history,
    });
  }
}

function validDigits(value) {
  return typeof value === "string" && /^\d{4}$/.test(value) && new Set(value).size === 4;
}

function judge(secret, guess) {
  let hit = 0;
  for (let i = 0; i < 4; i += 1) {
    if (secret[i] === guess[i]) hit += 1;
  }
  const blow = [...guess].filter((digit) => secret.includes(digit)).length - hit;
  return { hit, blow };
}

function leaveRoom(player, notify = true) {
  const room = player.room;
  if (!room) return;
  player.room = null;
  player.secret = null;
  const index = room.players.findIndex((candidate) => candidate && candidate.id === player.id);
  if (index !== -1) room.players[index] = null;
  const remaining = room.players.find(Boolean);
  if (remaining && notify) send(remaining.socket, { type: "opponent_left" });
  if (remaining) {
    rooms.delete(room.code);
    remaining.room = null;
  } else {
    rooms.delete(room.code);
  }
}

function handleMessage(player, message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "create_room") {
    if (player.room) leaveRoom(player, false);
    player.secret = null;
    let code;
    do {
      code = crypto.randomBytes(3).toString("hex").toUpperCase();
    } while (rooms.has(code));
    const room = {
      code,
      players: [player, null],
      status: "waiting",
      turn: null,
      winner: null,
      history: [],
    };
    player.room = room;
    rooms.set(code, room);
    sendState(room);
    return;
  }

  if (message.type === "join_room") {
    const code = typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
    const room = rooms.get(code);
    if (!room || room.players[1]) {
      sendError(player.socket, "ルームが見つからないか、満員です。コードを確認してください。");
      return;
    }
    if (player.room) leaveRoom(player, false);
    player.secret = null;
    room.players[1] = player;
    player.room = room;
    sendState(room);
    return;
  }

  const room = player.room;
  if (!room) {
    sendError(player.socket, "先にルームを作成するか、参加してください。");
    return;
  }

  if (message.type === "set_secret") {
    if (room.status !== "waiting" || player.secret) {
      sendError(player.socket, "数字を設定できません。");
      return;
    }
    if (!validDigits(message.secret)) {
      sendError(player.socket, "重複しない4桁の数字を入力してください。");
      return;
    }
    player.secret = message.secret;
    if (room.players.every((candidate) => candidate && candidate.secret)) {
      room.status = "playing";
      room.turn = room.players[0].id;
    }
    sendState(room);
    return;
  }

  if (message.type === "guess") {
    if (room.status !== "playing" || room.turn !== player.id) {
      sendError(player.socket, "現在はあなたの手番ではありません。");
      return;
    }
    if (!validDigits(message.guess)) {
      sendError(player.socket, "重複しない4桁の数字を入力してください。");
      return;
    }
    const opponent = room.players.find((candidate) => candidate && candidate.id !== player.id);
    if (!opponent || !opponent.secret) {
      sendError(player.socket, "相手の準備ができていません。");
      return;
    }
    const result = judge(opponent.secret, message.guess);
    room.history.push({ playerId: player.id, guess: message.guess, ...result });
    if (result.hit === 4) {
      room.status = "finished";
      room.winner = player.id;
    } else {
      room.turn = opponent.id;
    }
    sendState(room);
    return;
  }

  if (message.type === "leave_room") {
    leaveRoom(player);
  }
}

function handleFrame(socket, buffer) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const largeLength = buffer.readBigUInt64BE(offset + 2);
      if (largeLength > 16384n) {
        socket.destroy();
        return Buffer.alloc(0);
      }
      length = Number(largeLength);
      headerLength = 10;
    }
    if (length > 16384) {
      socket.destroy();
      return Buffer.alloc(0);
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (offset + frameLength > buffer.length) break;
    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    if (opcode === 0x8) {
      socket.end();
    } else if (opcode === 0x9) {
      socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
    } else if (opcode === 0x1) {
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch {
        sendError(socket, "メッセージを読み取れませんでした。");
        offset += frameLength;
        continue;
      }
      handleMessage(socket.player, message);
    }
    offset += frameLength;
  }
  return buffer.subarray(offset);
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key || request.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const player = { id: crypto.randomUUID(), socket, room: null, secret: null };
  socket.player = player;
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    pending = handleFrame(socket, Buffer.concat([pending, chunk]));
  });
  socket.on("close", () => leaveRoom(player));
  socket.on("error", () => leaveRoom(player));
});

server.listen(PORT, () => {
  console.log(`Hit & Blow is running at http://localhost:${PORT}`);
});
