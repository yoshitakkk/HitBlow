const online = {
  roomId: null,
  token: null,
  room: null,
  guess: [],
  busy: false,
  invalid: false,
  timer: null,
  generation: 0,
  mutation: 0,
};
const onlineTokens = document.querySelector("#online-tokens");
const onlineUndo = document.querySelector("#online-undo");

function onlineError(message) {
  document.querySelector("#online-error").textContent = message;
}

function roomUrl(roomId) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = `room=${roomId}`;
  return url.href;
}

async function onlineRequest(action, data) {
  const response = await fetch(`/api/rooms/${online.roomId}/${action}`, {
    method: action === "state" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${online.token}`,
      ...(action === "state" ? {} : { "Content-Type": "application/json" }),
    },
    ...(action === "state" ? {} : { body: JSON.stringify(data || {}) }),
    cache: "no-store",
  });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("サーバーからの応答が無効です。Cloudflare Workersで起動しているか確認してください。");
  }
  if (!response.ok) {
    const error = new Error(payload.error || `通信に失敗しました (${response.status})。`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function onlineCanEnter() {
  const room = online.room;
  return room && !online.busy && !online.invalid &&
    ((["waiting", "setup"].includes(room.phase) && !room.ready) ||
     (room.phase === "playing" && room.turn === room.player));
}

function renderOnlineTokens() {
  const colorMode = online.room.mode === "colors";
  onlineTokens.replaceChildren();
  onlineTokens.classList.toggle("color-mode", colorMode);
  onlineTokens.setAttribute("aria-label", colorMode ? "ボールの色を選ぶ" : "数字を選ぶ");
  modes[online.room.mode].tokens.forEach((token) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "digit-button";
    button.dataset.token = token;
    if (colorMode) {
      button.classList.add(`color-${token}`);
      button.setAttribute("aria-label", `${colorNames[token]}のボール`);
    } else {
      button.textContent = token;
      button.setAttribute("aria-label", token);
    }
    button.addEventListener("click", () => {
      if (!onlineCanEnter() || online.guess.length === 4 || online.guess.includes(token)) return;
      online.guess.push(token);
      updateOnlineInput();
      const next = [...onlineTokens.querySelectorAll("button")].find((candidate) => !candidate.disabled);
      (next || onlineUndo).focus();
    });
    onlineTokens.append(button);
  });
}

function formatOnlineSequence(sequence) {
  return online.room.mode === "numbers" ? sequence.join("") : sequence.map((token) => colorNames[token]).join("、");
}

function updateOnlineInput() {
  const allowed = onlineCanEnter();
  document.querySelectorAll("#online-slots > span").forEach((slot, index) => {
    slot.replaceChildren();
    slot.classList.toggle("filled", index < online.guess.length);
    const token = online.guess[index];
    if (!token) slot.textContent = "−";
    else if (online.room.mode === "colors") addColorBall(slot, token);
    else slot.textContent = token;
  });
  document.querySelector("#online-guess-status").textContent = online.guess.length
    ? `選択中: ${formatOnlineSequence(online.guess)}。${online.guess.length}つ選択中。`
    : "まだ選択されていません。";
  onlineTokens.querySelectorAll("button").forEach((button) => {
    const selected = online.guess.includes(button.dataset.token);
    button.disabled = !allowed || selected || online.guess.length === 4;
    button.classList.toggle("selected", selected);
  });
  onlineUndo.disabled = !allowed || online.guess.length === 0;
  document.querySelector("#online-submit").disabled = !allowed;
  document.querySelector("#online-surrender").disabled = online.busy || online.invalid || !online.room.joined || online.room.phase === "finished";
}

function renderOnlineHistory() {
  const list = document.querySelector("#online-history");
  list.replaceChildren();
  online.room.history.forEach((item) => {
    const row = document.createElement("li");
    row.className = "history-row";
    const player = document.createElement("span");
    player.className = "online-player";
    player.textContent = item.player === online.room.player ? "あなたの推理" : "相手の推理";
    const guess = document.createElement("span");
    guess.className = "history-guess";
    if (online.room.mode === "colors") {
      guess.classList.add("color-history-guess");
      guess.setAttribute("role", "img");
      guess.setAttribute("aria-label", formatOnlineSequence(item.guess));
      item.guess.forEach((token) => addColorBall(guess, token));
    } else {
      guess.textContent = formatOnlineSequence(item.guess);
    }
    const result = document.createElement("span");
    result.className = "history-result";
    const hit = document.createElement("span");
    hit.className = "hit-count";
    hit.textContent = `${item.hit} HIT`;
    const blow = document.createElement("span");
    blow.className = "blow-count";
    blow.textContent = `${item.blow} BLOW`;
    result.append(hit, blow);
    row.append(player, guess, result);
    list.prepend(row);
  });
  document.querySelector("#online-attempts").textContent = `${online.room.history.length}回`;
  document.querySelector("#online-empty").classList.toggle("hidden", online.room.history.length > 0);
}

function renderOnlineRoom(room) {
  const previous = online.room;
  online.room = room;
  if (!previous || previous.mode !== room.mode) renderOnlineTokens();
  if (previous && (previous.ready !== room.ready ||
      (previous.phase !== room.phase && ["playing", "finished"].includes(room.phase)))) online.guess = [];
  document.querySelector("#online-room-mode").textContent = `モード: ${room.mode === "colors" ? "6色ボール" : "数字"} / ${room.player === 0 ? "先攻" : "後攻"}`;
  document.querySelector("#online-invite").value = roomUrl(online.roomId);
  let status;
  if (room.phase === "finished") {
    status = room.winner === room.player ? "あなたの勝ちです！" : "相手の勝ちです。";
    if (room.reason === "surrender") status += " 降参により対戦が終了しました。";
    if (room.secrets[1 - room.player]) status += ` 相手の答え: ${formatOnlineSequence(room.secrets[1 - room.player])}。`;
  } else if (!room.joined) {
    status = "相手の参加を待っています。招待URLを送ってください。";
  } else if (!room.ready) {
    status = "相手に見せないよう、自分の答えを設定してください。";
  } else if (!room.opponentReady) {
    status = "相手が答えを設定するのを待っています。";
  } else {
    status = room.turn === room.player ? "あなたの手番です。相手の答えを推理してください。" : "相手の手番です。";
  }
  document.querySelector("#online-status").textContent = status;
  const setting = ["waiting", "setup"].includes(room.phase);
  document.querySelector("#online-entry-title").textContent = setting ? "自分の答えを設定" : "相手の答えを推理";
  document.querySelector("#online-description").textContent = room.mode === "colors"
    ? "6色から重複しないボールを4つ選んでください。"
    : "重複しない数字を4つ選んでください。先頭に0も使えます。";
  document.querySelector("#online-submit").textContent = setting ? "答えを設定" : "推理する";
  renderOnlineHistory();
  updateOnlineInput();
}

function stopOnline() {
  online.generation += 1;
  clearTimeout(online.timer);
  online.timer = null;
  online.busy = false;
  online.invalid = false;
  online.room = null;
  online.guess = [];
}

function scheduleOnlinePoll(generation) {
  clearTimeout(online.timer);
  online.timer = setTimeout(() => pollOnline(generation), 2000);
}

async function pollOnline(generation) {
  if (generation !== online.generation) return;
  if (online.busy) {
    scheduleOnlinePoll(generation);
    return;
  }
  const mutation = online.mutation;
  try {
    const room = await onlineRequest("state");
    if (generation !== online.generation || mutation !== online.mutation) return;
    document.querySelector("#online-connection").textContent = "";
    renderOnlineRoom(room);
    if (room.phase !== "finished") scheduleOnlinePoll(generation);
  } catch (error) {
    if (generation !== online.generation || mutation !== online.mutation) return;
    if ([401, 403, 404, 410].includes(error.status)) {
      document.querySelector("#online-connection").textContent = `部屋に接続できません: ${error.message}`;
      online.invalid = true;
      updateOnlineInput();
      return;
    }
    document.querySelector("#online-connection").textContent = `接続を確認してください。再試行します: ${error.message}`;
    scheduleOnlinePoll(generation);
  }
}

async function enterOnlineRoom(roomId, action, mode) {
  stopOnline();
  const generation = online.generation;
  online.roomId = roomId;
  const storageKey = `hitblow-room-${roomId}`;
  onlineError("");
  document.querySelector("#online-create").disabled = true;
  try {
    if (!crypto.randomUUID) throw new Error("オンライン対戦にはHTTPSまたはlocalhostが必要です。");
    online.token = sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, online.token);
    const room = await onlineRequest(action, { mode });
    if (generation !== online.generation) return;
    history.replaceState(null, "", roomUrl(roomId));
    document.querySelector("#online-lobby").classList.add("hidden");
    document.querySelector("#online-room").classList.remove("hidden");
    document.querySelector("#online-connection").textContent = "";
    renderOnlineRoom(room);
    if (room.phase !== "finished") scheduleOnlinePoll(generation);
  } catch (error) {
    if (generation !== online.generation) return;
    onlineError(`部屋に接続できません: ${error.message}`);
    document.querySelector("#online-lobby").classList.remove("hidden");
    document.querySelector("#online-room").classList.add("hidden");
  } finally {
    if (generation === online.generation) document.querySelector("#online-create").disabled = false;
  }
}

async function sendOnlineAction(action, data) {
  if (online.busy) return;
  const generation = online.generation;
  online.mutation += 1;
  online.busy = true;
  updateOnlineInput();
  onlineError("");
  try {
    const room = await onlineRequest(action, data);
    if (generation !== online.generation) return;
    online.guess = [];
    online.busy = false;
    renderOnlineRoom(room);
    if (room.phase !== "finished") scheduleOnlinePoll(generation);
  } catch (error) {
    if (generation !== online.generation) return;
    online.busy = false;
    updateOnlineInput();
    onlineError(`操作に失敗しました: ${error.message}`);
    scheduleOnlinePoll(generation);
  }
}

document.querySelector("#online-start-button").addEventListener("click", () => {
  stopOnline();
  document.querySelector("#online-lobby").classList.remove("hidden");
  document.querySelector("#online-room").classList.add("hidden");
  document.querySelector("#online-create").disabled = false;
  onlineError("");
  showScreen("online");
});
document.querySelector("#online-home").addEventListener("click", () => {
  stopOnline();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  showScreen("home");
});
document.querySelector("#online-create").addEventListener("click", () => {
  if (!crypto.randomUUID) {
    onlineError("オンライン対戦にはHTTPSまたはlocalhostが必要です。");
    return;
  }
  enterOnlineRoom(crypto.randomUUID(), "create", document.querySelector("#online-mode").value);
});
document.querySelector("#online-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector("#online-invite").value);
    onlineError("");
    document.querySelector("#online-connection").textContent = "招待URLをコピーしました。";
  } catch (error) {
    onlineError(`コピーできませんでした。招待URLを手動でコピーしてください: ${error.message}`);
    document.querySelector("#online-invite").select();
  }
});
onlineUndo.addEventListener("click", () => {
  const token = online.guess.pop();
  updateOnlineInput();
  onlineTokens.querySelector(`[data-token="${token}"]`).focus();
});
document.querySelector("#online-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!onlineCanEnter()) return;
  if (online.guess.length !== 4) {
    onlineError("重複しない4つの値を選んでください。");
    return;
  }
  sendOnlineAction(online.room.phase === "playing" ? "guess" : "secret", { sequence: online.guess });
});
document.querySelector("#online-surrender").addEventListener("click", () => {
  if (confirm("降参して対戦を終了しますか？")) sendOnlineAction("surrender");
});

const invitedRoom = new URLSearchParams(location.hash.slice(1)).get("room");
if (invitedRoom && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitedRoom)) {
  showScreen("online");
  enterOnlineRoom(invitedRoom, "join");
}
