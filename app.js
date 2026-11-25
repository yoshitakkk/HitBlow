const screens = {
  home: document.querySelector("#home-screen"),
  game: document.querySelector("#game-screen"),
};
const modes = {
  numbers: {
    tokens: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    title: "数字を当てよう",
    entryTitle: "4桁の数字を入力",
    description: "数字のボタンを4つ選んでください。先頭に0も使えます。",
    label: "数字",
  },
  colors: {
    tokens: ["red", "yellow", "pink", "blue", "green", "purple"],
    title: "6色ボールの並びを当てよう",
    entryTitle: "4色のボールを入力",
    description: "6色から重複しないボールを4つ選んでください。",
    label: "色",
  },
};
const colorNames = {
  red: "赤",
  yellow: "黄",
  pink: "ピンク",
  blue: "青",
  green: "緑",
  purple: "紫",
};
const state = {
  mode: "numbers",
  secret: [],
  history: [],
  guess: [],
};

const tokenButtons = document.querySelector("#token-buttons");
const undoButton = document.querySelector("#undo-digit");

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle("hidden", key !== name));
}

function randomSecret(tokens) {
  const shuffled = [...tokens];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, 4);
}

function evaluate(secret, guess) {
  const hit = guess.filter((token, index) => token === secret[index]).length;
  const blow = guess.filter((token) => secret.includes(token)).length - hit;
  return { hit, blow };
}

function formatGuess(guess) {
  return state.mode === "numbers" ? guess.join("") : guess.map((token) => colorNames[token]).join("、");
}

function addColorBall(container, token) {
  const ball = document.createElement("span");
  ball.className = `color-ball color-${token}`;
  ball.setAttribute("aria-label", colorNames[token]);
  container.append(ball);
}

function renderTokenButtons() {
  const colorMode = state.mode === "colors";
  tokenButtons.classList.toggle("color-mode", colorMode);
  tokenButtons.setAttribute("aria-label", colorMode ? "ボールの色を選ぶ" : "数字を選ぶ");
  tokenButtons.replaceChildren();
  modes[state.mode].tokens.forEach((token) => {
    const button = document.createElement("button");
    button.className = "digit-button";
    button.type = "button";
    button.dataset.token = token;
    if (colorMode) {
      button.classList.add(`color-${token}`);
      button.setAttribute("aria-label", `${colorNames[token]}のボール`);
    } else {
      button.textContent = token;
      button.setAttribute("aria-label", token);
    }
    button.addEventListener("click", () => {
      if (state.guess.length >= 4 || state.guess.includes(token)) return;
      state.guess.push(token);
      updateGuess();
      const nextButton = [...tokenButtons.querySelectorAll("button")].find((candidate) => !candidate.disabled);
      (nextButton || undoButton).focus();
    });
    tokenButtons.append(button);
  });
}

function updateGuess() {
  document.querySelectorAll("#guess-slots > span").forEach((slot, index) => {
    slot.replaceChildren();
    slot.classList.toggle("filled", index < state.guess.length);
    if (state.guess[index]) {
      if (state.mode === "colors") addColorBall(slot, state.guess[index]);
      else slot.textContent = state.guess[index];
    } else {
      slot.textContent = "−";
    }
  });
  document.querySelector("#guess-status").textContent = state.guess.length
    ? `入力中の${modes[state.mode].label}: ${formatGuess(state.guess)}。${state.guess.length}つ選択中。`
    : `${modes[state.mode].label}はまだ選択されていません。`;
  tokenButtons.querySelectorAll("button").forEach((button) => {
    const selected = state.guess.includes(button.dataset.token);
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
  state.guess = [];
  renderTokenButtons();
  updateGuess();
}

function addHistoryItem(item) {
  const row = document.createElement("li");
  row.className = "history-row";
  const guess = document.createElement("span");
  guess.className = "history-guess";
  if (state.mode === "colors") {
    guess.classList.add("color-history-guess");
    guess.setAttribute("role", "img");
    guess.setAttribute("aria-label", formatGuess(item.guess));
    item.guess.forEach((token) => addColorBall(guess, token));
  } else {
    guess.textContent = formatGuess(item.guess);
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
  row.append(guess, result);
  document.querySelector("#history-list").prepend(row);
  document.querySelector("#empty-history").classList.add("hidden");
}

function startSolo(mode = state.mode) {
  state.mode = mode;
  state.secret = randomSecret(modes[mode].tokens);
  state.history = [];
  document.querySelector("#game-title").textContent = modes[mode].title;
  document.querySelector("#entry-title").textContent = modes[mode].entryTitle;
  document.querySelector("#play-description").textContent = modes[mode].description;
  document.querySelector("#guess-label").textContent = mode === "colors" ? "入力したボール" : "入力した数字";
  document.querySelector("#history-guess-label").textContent = mode === "colors" ? "入力したボール" : "入力した数字";
  resetView();
  showScreen("game");
  tokenButtons.querySelector("button").focus();
}

function showResult(won, attempts) {
  document.querySelector("#game-layout").classList.add("hidden");
  document.querySelector("#result-panel").classList.remove("hidden");
  document.querySelector("#result-title").textContent = won ? "正解！お見事。" : "ギブアップしました。";
  document.querySelector("#result-copy").textContent = won
    ? `${attempts}回の推理で正解しました。答えは ${formatGuess(state.secret)} でした。`
    : `正解は ${formatGuess(state.secret)} でした。${attempts > 0 ? `ここまで${attempts}回推理しました。` : ""}`;
}

function submitGuess() {
  const result = evaluate(state.secret, state.guess);
  const item = { guess: [...state.guess], ...result };
  state.history.push(item);
  addHistoryItem(item);
  document.querySelector("#attempt-count").textContent = `${state.history.length}回`;
  state.guess = [];
  updateGuess();
  if (result.hit === 4) {
    showResult(true, state.history.length);
    document.querySelector("#play-again").focus();
  } else {
    tokenButtons.querySelector("button").focus();
  }
}

document.querySelector("#start-button").addEventListener("click", () => startSolo("numbers"));
document.querySelector("#color-start-button").addEventListener("click", () => startSolo("colors"));
document.querySelectorAll("[data-action='home']").forEach((button) => button.addEventListener("click", () => showScreen("home")));
undoButton.addEventListener("click", () => {
  const removed = state.guess.pop();
  updateGuess();
  tokenButtons.querySelector(`[data-token="${removed}"]`).focus();
});
document.querySelector("#guess-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.guess.length !== 4 || new Set(state.guess).size !== 4) {
    document.querySelector("#game-message").textContent = `${modes[state.mode].label}を重複しないように4つ選んでください。`;
    return;
  }
  submitGuess();
});
document.querySelector("#restart-button").addEventListener("click", () => startSolo());
document.querySelector("#play-again").addEventListener("click", () => startSolo());
document.querySelector("#give-up-button").addEventListener("click", () => {
  showResult(false, state.history.length);
  document.querySelector("#play-again").focus();
});
