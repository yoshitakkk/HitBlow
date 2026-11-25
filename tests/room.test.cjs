const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const worker = readFile(path.join(__dirname, "..", "worker.js"), "utf8")
  .then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));
const host = "11111111-1111-4111-8111-111111111111";
const guest = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const roomId = "44444444-4444-4444-8444-444444444444";

async function fixture() {
  const { Room, default: router } = await worker;
  let value;
  let pending = Promise.resolve();
  const storage = {
    async get() { return structuredClone(value); },
    async put(key, next) { value = structuredClone(next); },
    async deleteAll() { value = undefined; },
    async setAlarm(time) { this.alarmTime = time; },
    transaction(callback) {
      const current = pending.then(() => callback(this));
      pending = current.then(() => {}, () => {});
      return current;
    },
  };
  const object = new Room({ storage });
  const env = { ROOMS: { idFromName: (name) => name, get: () => object } };
  async function call(token, action, body = {}, extra = {}) {
    const request = new Request(`https://example.test/api/rooms/${roomId}/${action}`, {
      method: action === "state" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra },
      ...(action === "state" ? {} : { body: JSON.stringify(body) }),
    });
    const response = await router.fetch(request, env);
    return { status: response.status, body: await response.json() };
  }
  return { call, object, storage };
}

for (const mode of ["numbers", "colors"]) {
  test(`${mode}: 2人で設定、交互に推理して終了`, async () => {
    const { call, storage } = await fixture();
    const first = mode === "numbers" ? ["0", "1", "2", "3"] : ["red", "yellow", "pink", "blue"];
    const second = mode === "numbers" ? ["4", "5", "6", "7"] : ["green", "purple", "pink", "blue"];
    assert.equal((await call(host, "create", { mode })).status, 201);
    assert.ok(storage.alarmTime > Date.now());
    const secret = await call(host, "secret", { sequence: first });
    assert.equal(secret.body.secrets, null);
    assert.equal((await call(guest, "join")).body.player, 1);
    assert.equal((await call(other, "join")).status, 409);
    assert.equal((await call(guest, "secret", { sequence: [second[0], second[0], second[2], second[3]] })).status, 400);
    const start = await call(guest, "secret", { sequence: second });
    assert.equal(start.body.phase, "playing");
    assert.equal(start.body.secrets, null);
    assert.equal((await call(guest, "guess", { sequence: first })).status, 409);
    const guess = [second[1], second[0], second[2], first[0]];
    const attempts = await Promise.all([
      call(host, "guess", { sequence: guess }),
      call(host, "guess", { sequence: guess }),
    ]);
    assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), [200, 409]);
    const accepted = attempts.find((attempt) => attempt.status === 200).body;
    assert.deepEqual(accepted.history[0], { player: 0, guess, hit: 1, blow: 2 });
    assert.equal(accepted.turn, 1);
    assert.equal((await call(host, "state")).body.secrets, null);
    const win = await call(guest, "guess", { sequence: first });
    assert.equal(win.body.phase, "finished");
    assert.equal(win.body.winner, 1);
    assert.deepEqual(win.body.secrets, [first, second]);
    assert.equal((await call(host, "guess", { sequence: second })).status, 409);
  });
}

test("降参、認証、再参加、有効期限", async () => {
  const { call, object, storage } = await fixture();
  assert.equal((await call(host, "create", { mode: "invalid" })).status, 400);
  assert.equal((await call(host, "create", { mode: "numbers" }, { Origin: "https://other.test" })).status, 403);
  assert.equal((await call(host, "create", { mode: "numbers" })).status, 201);
  assert.equal((await call(other, "state")).status, 403);
  assert.equal((await call(host, "surrender")).status, 409);
  await call(guest, "join");
  assert.equal((await call(guest, "join")).body.player, 1);
  const result = await call(guest, "surrender");
  assert.equal(result.body.winner, 0);
  assert.equal(result.body.reason, "surrender");
  assert.equal((await call(host, "surrender")).status, 409);
  const stored = await storage.get("room");
  stored.expiresAt = Date.now() - 1;
  await storage.put("room", stored);
  assert.equal((await call(host, "state")).status, 410);
  await object.alarm();
  assert.equal((await call(host, "state")).status, 404);
});
