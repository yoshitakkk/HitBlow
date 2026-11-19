const screens = {
  home: document.querySelector("#home-screen"),
  game: document.querySelector("#game-screen"),
};
const state = {
  secret: "",
  history: [],
  guess: "",
};

const digitButtons = document.querySelectorAll("[data-digit]");
const undoButton = document.querySelector("#undo-digit");

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

function updateGuess() {
  document.querySelectorAll("#guess-slots span").forEach((slot, index) => {
    slot.textContent = state.guess[index] || "−";
    slot.classList.toggle("filled", index < state.guess.length);
  });
  document.querySelector("#guess-status").textContent = state.guess
    ? `入力中の数字: ${[...state.guess].join("、")}。${state.guess.length}桁選択中。`
    : "数字はまだ選択されていません。";
  digitButtons.forEach((button) => {
    const selected = state.guess.includes(button.dataset.digit);
    button.disabled = selected || state.guess.length === 4;
    button.classList.toggle("selected", selected);
  });
  undoButton.disabled = state.guess.length === 0;
  document.querySelector("#game-message").textContent = "";
}

function resetView() {
  document.querySelector("#history-list").replaceChildren();
  document.querySelector("#attempt-count").textContent = "0回";
  document.querySelector("#empty-history").classList.remove("hidden");
  document.querySelector("#game-layout").classList.remove("hidden");
  document.querySelector("#result-panel").classList.add("hidden");
  state.guess = "";
  updateGuess();
}

function addHistoryItem(item) {
  const row = document.createElement("li");
  row.className = "history-row";
  const guess = document.createElement("span");
  guess.className = "history-guess";
  guess.textContent = item.guess;
  const result = document.createElement("span");
  result.className = "history-result";
  const hit = document.createElement("span");
  hit.className = "hit-count";
  hit.textContent = `${item.hit} HIT`;
  const blow = document.createElement("span");
  blow.className = "blow-count";
  blow.textContent = `${item.blow} BLOW`;
  result.append(hit, blow);
  row.append(guess, result);
  document.querySelector("#history-list").prepend(row);
  document.querySelector("#empty-history").classList.add("hidden");
}

function startSolo() {
  state.secret = randomSecret();
  state.history = [];
  resetView();
  showScreen("game");
  digitButtons[0].focus();
}

function showResult(won, attempts) {
  document.querySelector("#game-layout").classList.add("hidden");
  document.querySelector("#result-panel").classList.remove("hidden");
  document.querySelector("#result-title").textContent = won ? "正解！お見事。" : "ギブアップしました。";
  document.querySelector("#result-copy").textContent = won
    ? `${attempts}回の推理で正解しました。答えは ${state.secret} でした。`
    : `正解は ${state.secret} でした。${attempts > 0 ? `ここまで${attempts}回推理しました。` : ""}`;
}

function submitGuess(guess) {
  const result = evaluate(state.secret, guess);
  state.history.push({ guess, ...result });
  addHistoryItem({ guess, ...result });
  document.querySelector("#attempt-count").textContent = `${state.history.length}回`;
  state.guess = "";
  updateGuess();
  if (result.hit === 4) {
    showResult(true, state.history.length);
    document.querySelector("#play-again").focus();
  } else {
    digitButtons[0].focus();
  }
}

document.querySelector("#start-button").addEventListener("click", startSolo);
document.querySelectorAll("[data-action='home']").forEach((button) => button.addEventListener("click", () => showScreen("home")));
digitButtons.forEach((button) => button.addEventListener("click", () => {
  if (state.guess.length >= 4 || state.guess.includes(button.dataset.digit)) return;
  state.guess += button.dataset.digit;
  updateGuess();
  const nextButton = [...digitButtons].find((candidate) => !candidate.disabled);
  (nextButton || undoButton).focus();
}));
undoButton.addEventListener("click", () => {
  const removed = state.guess.slice(-1);
  state.guess = state.guess.slice(0, -1);
  updateGuess();
  document.querySelector(`[data-digit="${removed}"]`).focus();
});
document.querySelector("#guess-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isValidGuess(state.guess)) {
    document.querySelector("#game-message").textContent = "数字を4桁選んでください。";
    return;
  }
  submitGuess(state.guess);
});
document.querySelector("#restart-button").addEventListener("click", startSolo);
document.querySelector("#play-again").addEventListener("click", startSolo);
document.querySelector("#give-up-button").addEventListener("click", () => {
  showResult(false, state.history.length);
  document.querySelector("#play-again").focus();
});
