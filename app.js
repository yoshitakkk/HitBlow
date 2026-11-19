const screens = {
  home: document.querySelector("#home-screen"),
  online: document.querySelector("#online-screen"),
  game: document.querySelector("#game-screen"),
};
const state = {
  mode: null,
  secret: "",
  history: [],
  socket: null,
  roomCode: "",
  playerId: "",
  onlineStatus: "waiting",
  turn: null,
  winner: null,
  ownReady: false,
  opponentReady: false,
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle("hidden", key !== name));
}

function randomSecret() {
  const digits = [];
  while (digits.length < 4) {
    const digit = String(Math.floor(Math.random() * 10));
    if (!digits.includes(digit)) digits.push(digit);
  }
  return digits.join("");
}

function isValidGuess(value) {
  return /^\d{4}$/.test(value) && new Set(value).size === 4;
}

function evaluate(secret, guess) {
  let hit = 0;
  for (let index = 0; index < 4; index += 1) {
    if (secret[index] === guess[index]) hit += 1;
  }
  const blow = [...guess].filter((digit) => secret.includes(digit)).length - hit;
  return { hit, blow };
}

function resetView() {
  document.querySelector("#history-list").replaceChildren();
  document.querySelector("#history-count").textContent = "0";
  document.querySelector("#attempt-count").textContent = "0 GUESSES";
  document.querySelector("#empty-history").classList.remove("hidden");
  document.querySelector("#game-layout").classList.remove("hidden");
  document.querySelector("#result-panel").classList.add("hidden");
  document.querySelector("#game-message").textContent = "";
  document.querySelector("#guess-input").value = "";
  document.querySelector("#guess-input").disabled = false;
  document.querySelector("#guess-form").classList.remove("hidden");
}

function addHistoryItem(item, isOnline = false) {
  const row = document.createElement("li");
  row.className = "history-row";
  const guess = document.createElement("span");
  guess.className = "history-guess";
  guess.textContent = item.guess;
  const result = document.createElement("span");
  result.className = "history-result";
  if (isOnline) {
    const player = document.createElement("span");
    player.className = "history-player";
    player.textContent = item.playerId === state.playerId ? "YOU" : "OPPONENT";
    row.append(guess, player);
  } else {
    row.append(guess);
  }
  const hit = document.createElement("span");
  hit.className = "hit-count";
  hit.textContent = `${item.hit} HIT`;
  const blow = document.createElement("span");
  blow.className = "blow-count";
  blow.textContent = `${item.blow} BLOW`;
  result.append(hit, blow);
  row.append(result);
  document.querySelector("#history-list").prepend(row);
  document.querySelector("#empty-history").classList.add("hidden");
}

function setHeader(mode) {
  const online = mode === "online";
  document.querySelector("#game-mode-label").textContent = online ? "02" : "01";
  document.querySelector("#game-mode-caption").textContent = online ? "ONLINE MATCH" : "SOLO CHALLENGE";
  document.querySelector("#game-title").textContent = online ? "相手の数字を見抜こう。" : "数字を見つけよう。";
  document.querySelector("#game-footer-left").textContent = online ? "TAKE TURNS, READ YOUR OPPONENT" : "EVERY GUESS GETS YOU CLOSER";
  document.querySelector("#room-banner").classList.toggle("hidden", !online);
  document.querySelector("#secret-panel").classList.toggle("hidden", !online);
  document.querySelector("#game-layout").classList.toggle("hidden", online);
  document.querySelector("#result-panel").classList.add("hidden");
}

function startSolo() {
  closeSocket();
  state.mode = "solo";
  state.secret = randomSecret();
  state.history = [];
  setHeader("solo");
  resetView();
  document.querySelector("#play-prompt").textContent = "4桁の数字を入力。";
  document.querySelector("#play-description").textContent = "数字はすべて異なるものにしてください。";
  document.querySelector("#turn-indicator").textContent = "YOUR TURN";
  showScreen("game");
  document.querySelector("#guess-input").focus();
}

function showResult(won, attempts, multiplayer = false) {
  document.querySelector("#game-layout").classList.add("hidden");
  document.querySelector("#secret-panel").classList.add("hidden");
  const resultPanel = document.querySelector("#result-panel");
  resultPanel.classList.remove("hidden");
  document.querySelector("#result-mark").textContent = won ? "✳" : "↗";
  document.querySelector("#result-kicker").textContent = won ? "BRILLIANT GUESS" : "MATCH FINISHED";
  document.querySelector("#result-title").textContent = won ? "正解！お見事。" : "今回は相手の勝ち。";
  document.querySelector("#result-copy").textContent = multiplayer
    ? won ? "相手の数字を見抜きました。" : "次はあなたが先に見抜こう。"
    : `${attempts}回の推理で正解しました。答えは ${state.secret} でした。`;
}

function submitSoloGuess(guess) {
  const result = evaluate(state.secret, guess);
  state.history.push({ guess, ...result });
  addHistoryItem({ guess, ...result });
  document.querySelector("#history-count").textContent = String(state.history.length);
  document.querySelector("#attempt-count").textContent = `${state.history.length} GUESSES`;
  document.querySelector("#guess-input").value = "";
  document.querySelector("#game-message").textContent = "";
  if (result.hit === 4) showResult(true, state.history.length);
}

function getWebSocketUrl() {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}`;
}

function connectSocket(onReady) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    onReady();
    return;
  }
  const socket = new WebSocket(getWebSocketUrl());
  state.socket = socket;
  socket.addEventListener("open", onReady, { once: true });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showOnlineError("サーバーからの応答を読み取れませんでした。");
      return;
    }
    handleServerMessage(message);
  });
  socket.addEventListener("error", () => showOnlineError("接続できません。時間をおいてもう一度お試しください。"));
  socket.addEventListener("close", () => {
    if (state.mode === "online") {
      document.querySelector("#connection-status").textContent = "接続が切れました";
      document.querySelector("#game-message").textContent = "サーバーとの接続が切れました。";
    }
  });
}

function sendSocketMessage(message) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(message));
}

function closeSocket() {
  if (!state.socket) return;
  if (state.socket.readyState === WebSocket.OPEN) sendSocketMessage({ type: "leave_room" });
  state.socket.close();
  state.socket = null;
  state.roomCode = "";
}

function showOnlineError(message) {
  const error = document.querySelector("#online-error");
  error.textContent = message;
}

function enterOnlineGame() {
  state.mode = "online";
  state.history = [];
  setHeader("online");
  resetView();
  document.querySelector("#secret-panel").classList.remove("hidden");
  document.querySelector("#game-layout").classList.add("hidden");
  document.querySelector("#secret-input").value = "";
  document.querySelector("#secret-input").disabled = false;
  document.querySelector("#secret-form").classList.remove("hidden");
  document.querySelector("#secret-waiting").classList.add("hidden");
  document.querySelector("#room-code-display").textContent = state.roomCode;
  document.querySelector("#connection-status").textContent = "相手を待っています";
  document.querySelector("#play-prompt").textContent = "相手の数字を推理。";
  document.querySelector("#play-description").textContent = "交互に1回ずつ推理します。";
  document.querySelector("#turn-indicator").textContent = "WAITING";
  document.querySelector("#guess-input").disabled = true;
  showScreen("game");
}

function handleServerMessage(message) {
  if (message.type === "error") {
    document.querySelector("#game-message").textContent = message.message;
    showOnlineError(message.message);
    return;
  }
  if (message.type === "opponent_left") {
    document.querySelector("#connection-status").textContent = "相手が退出しました";
    document.querySelector("#game-message").textContent = "相手との接続が終了しました。";
    document.querySelector("#guess-input").disabled = true;
    return;
  }
  if (message.type !== "state") return;
  if (screens.game.classList.contains("hidden")) enterOnlineGame();
  state.roomCode = message.roomCode;
  state.playerId = message.playerId;
  state.onlineStatus = message.status;
  state.turn = message.turn;
  state.winner = message.winner;
  state.ownReady = message.ownReady;
  state.opponentReady = message.opponentReady;
  document.querySelector("#room-code-display").textContent = state.roomCode;
  document.querySelector("#connection-status").textContent = message.playerCount < 2
    ? "相手を待っています"
    : message.status === "waiting" ? "ふたりが数字を設定してください" : "接続中 · 2 PLAYERS";

  if (!message.ownReady) {
    document.querySelector("#secret-panel").classList.remove("hidden");
    document.querySelector("#secret-form").classList.remove("hidden");
    document.querySelector("#secret-input").disabled = false;
    document.querySelector("#secret-waiting").classList.add("hidden");
    document.querySelector("#game-layout").classList.add("hidden");
    return;
  }

  document.querySelector("#secret-form").classList.add("hidden");
  document.querySelector("#secret-input").disabled = true;
  if (message.status === "waiting") {
    document.querySelector("#secret-panel").classList.remove("hidden");
    document.querySelector("#secret-waiting").classList.toggle("hidden", message.opponentReady);
    document.querySelector("#secret-waiting").textContent = message.opponentReady ? "相手が数字を決めています…" : "相手の準備を待っています…";
    document.querySelector("#game-layout").classList.add("hidden");
    return;
  }
  document.querySelector("#secret-panel").classList.add("hidden");
  document.querySelector("#game-layout").classList.remove("hidden");
  const list = document.querySelector("#history-list");
  list.replaceChildren();
  document.querySelector("#empty-history").classList.toggle("hidden", message.history.length > 0);
  for (const item of [...message.history].reverse()) addHistoryItem(item, true);
  document.querySelector("#history-count").textContent = String(message.history.length);
  document.querySelector("#attempt-count").textContent = `${message.history.length} TOTAL GUESSES`;
  document.querySelector("#guess-input").value = "";
  document.querySelector("#game-message").textContent = "";

  if (message.status === "finished") {
    showResult(message.winner === message.playerId, message.history.length, true);
    document.querySelector("#result-kicker").textContent = message.winner === message.playerId ? "YOU WIN" : "MATCH FINISHED";
    document.querySelector("#result-title").textContent = message.winner === message.playerId ? "読み勝ち！" : "相手が正解しました。";
    document.querySelector("#result-copy").textContent = message.winner === message.playerId ? "相手の数字を見抜きました。" : "次はあなたが先に見抜こう。";
    document.querySelector("#result-mark").textContent = message.winner === message.playerId ? "✳" : "↗";
    return;
  }

  const myTurn = message.turn === message.playerId;
  document.querySelector("#turn-indicator").textContent = myTurn ? "YOUR TURN" : "OPPONENT'S TURN";
  document.querySelector("#play-prompt").textContent = myTurn ? "あなたの推理です。" : "相手が推理しています。";
  document.querySelector("#play-description").textContent = myTurn ? "数字はすべて異なるものにしてください。" : "相手の推理を待っています。";
  document.querySelector("#guess-input").disabled = !myTurn;
  document.querySelector("#guess-form").classList.toggle("hidden", !myTurn);
  if (myTurn) document.querySelector("#guess-input").focus();
}

function startOnline(action, code = "") {
  showOnlineError("");
  connectSocket(() => {
    if (action === "create") sendSocketMessage({ type: "create_room" });
    else sendSocketMessage({ type: "join_room", code });
  });
  state.mode = "online";
}

document.querySelectorAll("[data-action='solo']").forEach((button) => button.addEventListener("click", startSolo));
document.querySelectorAll("[data-action='online']").forEach((button) => button.addEventListener("click", () => {
  showOnlineError("");
  showScreen("online");
}));
document.querySelectorAll("[data-action='home']").forEach((button) => button.addEventListener("click", () => {
  closeSocket();
  state.mode = null;
  showScreen("home");
}));
document.querySelector("[data-action='create-room']").addEventListener("click", () => startOnline("create"));
document.querySelector("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = document.querySelector("#room-code").value.trim();
  if (!code) {
    showOnlineError("ルームコードを入力してください。");
    return;
  }
  startOnline("join", code);
});
document.querySelector("#secret-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const secret = document.querySelector("#secret-input").value;
  if (!isValidGuess(secret)) {
    document.querySelector("#game-message").textContent = "重複しない4桁の数字を入力してください。";
    return;
  }
  state.secret = secret;
  sendSocketMessage({ type: "set_secret", secret });
  document.querySelector("#secret-input").disabled = true;
  document.querySelector("#secret-form").classList.add("hidden");
  document.querySelector("#secret-waiting").classList.remove("hidden");
});
document.querySelector("#guess-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#guess-input");
  const guess = input.value;
  if (!isValidGuess(guess)) {
    document.querySelector("#game-message").textContent = "重複しない4桁の数字を入力してください。";
    return;
  }
  if (state.mode === "solo") submitSoloGuess(guess);
  else sendSocketMessage({ type: "guess", guess });
});
document.querySelector("#restart-button").addEventListener("click", () => {
  if (state.mode === "solo") startSolo();
  else {
    closeSocket();
    state.mode = null;
    showScreen("online");
  }
});
document.querySelector("#play-again").addEventListener("click", () => {
  if (state.mode === "solo") startSolo();
  else {
    closeSocket();
    state.mode = null;
    showScreen("online");
  }
});
document.querySelector("#copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.roomCode);
    document.querySelector("#copy-code").textContent = "コピー済み";
  } catch {
    document.querySelector("#game-message").textContent = "コードを選択してコピーしてください。";
  }
});
document.querySelectorAll(".number-input").forEach((input) => input.addEventListener("input", () => {
  input.value = input.value.replace(/\D/g, "").slice(0, 4);
}));
