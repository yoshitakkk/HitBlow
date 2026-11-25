const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKENS = {
  numbers: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  colors: ["red", "yellow", "pink", "blue", "green", "purple"],
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function validSequence(mode, sequence) {
  return Array.isArray(sequence) && sequence.length === 4 &&
    new Set(sequence).size === 4 && sequence.every((token) => TOKENS[mode].includes(token));
}

function evaluate(secret, guess) {
  const hit = guess.filter((token, index) => token === secret[index]).length;
  return { hit, blow: guess.filter((token) => secret.includes(token)).length - hit };
}

function viewRoom(room, player) {
  const opponent = 1 - player;
  return {
    mode: room.mode,
    player,
    joined: Boolean(room.players[1]),
    ready: Boolean(room.secrets[player]),
    opponentReady: Boolean(room.secrets[opponent]),
    phase: room.phase,
    turn: room.phase === "playing" ? room.turn : null,
    history: room.history,
    winner: room.winner,
    reason: room.reason,
    secrets: room.phase === "finished" ? room.secrets : null,
    expiresAt: room.expiresAt,
  };
}

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split("/").pop();
    const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
    if (!token || !UUID.test(token)) return json({ error: "認証情報が無効です。" }, 401);
    if ((action === "state" && request.method !== "GET") ||
        (action !== "state" && request.method !== "POST")) {
      return json({ error: "対応していないリクエストです。" }, 405);
    }

    let body = {};
    if (request.method === "POST") {
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
        return json({ error: "JSONを送信してください。" }, 415);
      }
      const text = await request.text();
      if (text.length > 1024) return json({ error: "データが大きすぎます。" }, 413);
      try {
        body = JSON.parse(text);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return json({ error: "JSONが無効です。" }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ error: "データが無効です。" }, 400);
      }
    }

    const result = await this.ctx.storage.transaction(async (storage) => {
      let room = await storage.get("room");
      if (room && room.expiresAt <= Date.now()) return { error: "この部屋の有効期限は切れました。", status: 410 };
      if (action === "create") {
        if (room) return { error: "この部屋は既に作成されています。", status: 409 };
        if (!Object.hasOwn(TOKENS, body.mode)) return { error: "モードが無効です。", status: 400 };
        room = {
          mode: body.mode, players: [token, null], secrets: [null, null], phase: "waiting",
          turn: 0, history: [], winner: null, reason: null, expiresAt: Date.now() + ROOM_LIFETIME_MS,
        };
        await storage.put("room", room);
        return { room: viewRoom(room, 0), created: true, expiresAt: room.expiresAt };
      }
      if (!room) return { error: "部屋が見つかりません。", status: 404 };
      let player = room.players.indexOf(token);
      if (action === "join" && player === -1) {
        if (room.players[1]) return { error: "この部屋は満員です。", status: 409 };
        room.players[1] = token;
        room.phase = "setup";
        player = 1;
        await storage.put("room", room);
      }
      if (player === -1) return { error: "この部屋に参加していません。", status: 403 };
      if (action === "state" || action === "join") return { room: viewRoom(room, player) };
      if (action === "secret") {
        if (!["waiting", "setup"].includes(room.phase) || room.secrets[player]) {
          return { error: "答えは既に設定されています。", status: 409 };
        }
        if (!validSequence(room.mode, body.sequence)) return { error: "重複しない4つの値を選んでください。", status: 400 };
        room.secrets[player] = body.sequence;
        if (room.players[1] && room.secrets.every(Boolean)) room.phase = "playing";
      } else if (action === "guess") {
        if (room.phase !== "playing" || room.turn !== player) return { error: "今はあなたの手番ではありません。", status: 409 };
        if (!validSequence(room.mode, body.sequence)) return { error: "重複しない4つの値を選んでください。", status: 400 };
        const result = evaluate(room.secrets[1 - player], body.sequence);
        room.history.push({ player, guess: body.sequence, ...result });
        if (result.hit === 4) {
          room.phase = "finished";
          room.winner = player;
          room.reason = "solved";
        } else {
          room.turn = 1 - player;
        }
      } else if (action === "surrender") {
        if (!room.players[1] || room.phase === "finished") return { error: "この対戦では降参できません。", status: 409 };
        room.phase = "finished";
        room.winner = 1 - player;
        room.reason = "surrender";
      } else {
        return { error: "操作が見つかりません。", status: 404 };
      }
      await storage.put("room", room);
      return { room: viewRoom(room, player) };
    });

    if (result.error) return json({ error: result.error }, result.status);
    if (result.created) await this.ctx.storage.setAlarm(result.expiresAt);
    return json(result.room, result.created ? 201 : 200);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "POST" && request.headers.has("Origin") &&
        request.headers.get("Origin") !== url.origin) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(create|join|state|secret|guess|surrender)$/);
    if (!match || !UUID.test(match[1])) return json({ error: "リクエストが無効です。" }, 404);
    const id = env.ROOMS.idFromName(match[1].toLowerCase());
    return env.ROOMS.get(id).fetch(request);
  },
};
