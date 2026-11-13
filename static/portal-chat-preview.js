"use strict";

(() => {
  const form = document.getElementById("chat-preview-form");
  const input = document.getElementById("chat-preview-input");
  const log = document.getElementById("chat-preview-log");
  if (!form || !input || !log) return;

  const localPreview = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const avatars = [
    "/static/avatars/users/bear/bear-apricot-head-bow-happy.png",
    "/static/avatars/users/fox/fox-apricot-flower-open.png",
    "/static/avatars/users/cat/cat-ocean-flower-happy.png",
    "/static/avatars/users/frog/frog-lilac-head-bow-happy.png",
    "/static/avatars/users/bunny/bunny-ocean-classic-happy.png",
  ];
  const players = [
    { name:"Dragonfruit", avatar:avatars[0], tokens:18420, wins:62 },
    { name:"Kiwi", avatar:avatars[1], tokens:15640, wins:54 },
    { name:"Mango", avatar:avatars[2], tokens:12880, wins:47 },
    { name:"Blueberry", avatar:avatars[3], tokens:11120, wins:40 },
    { name:"Peach", avatar:avatars[4], tokens:9870, wins:36 },
  ];

  const makeAvatar = (src, className) => {
    const image = document.createElement("img");
    image.className = className;
    image.src = src;
    image.alt = "";
    image.loading = "lazy";
    return image;
  };

  function fillPodium(panel, metric) {
    const byRank = new Map(players.map((player, index) => [index + 1, player]));
    for (const [selector, rank] of [[".podium-second", 2], [".podium-first", 1], [".podium-third", 3]]) {
      const card = panel.querySelector(selector);
      const player = byRank.get(rank);
      if (!card || !player) continue;
      const avatar = card.querySelector(".podium-avatar");
      avatar.replaceChildren(makeAvatar(player.avatar, "fruit-avatar"));
      card.querySelector(".podium-name").textContent = player.name;
      card.querySelector(".podium-score").textContent = player[metric].toLocaleString("en-US");
      card.querySelector(".podium-metric").textContent = metric === "tokens" ? "gems" : metric;
    }
    const list = panel.querySelector(".leaderboard-list");
    const empty = list.querySelector(".leaderboard-empty");
    const rows = players.slice(3).map((player, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-player-row";
      const rank = document.createElement("span");
      rank.className = "leaderboard-player-rank";
      rank.textContent = String(index + 4);
      const identity = document.createElement("span");
      identity.className = "leaderboard-player-identity";
      identity.append(makeAvatar(player.avatar, "fruit-avatar"));
      const name = document.createElement("strong");
      name.className = "leaderboard-player-name";
      name.textContent = player.name;
      identity.append(name);
      const score = document.createElement("strong");
      score.className = "leaderboard-player-score";
      score.textContent = player[metric].toLocaleString("en-US");
      row.append(rank, identity, score);
      return row;
    });
    if (empty) empty.replaceWith(...rows);
  }

  if (localPreview) {
    for (const [id, metric] of [["leaderboard-tokens", "tokens"], ["leaderboard-wins", "wins"]]) {
      const panel = document.getElementById(id);
      if (panel) fillPodium(panel, metric);
    }
    const fruitNames = ["Dragonfruit", "Kiwi", "Mango", "Blueberry", "Peach"];
    const randomWords = [
      "comet", "pixel", "waffle", "orbit", "jelly", "rocket", "puddle", "marble", "pickle", "wizard",
      "tumble", "nebula", "pancake", "button", "scooter", "bubble", "noodle", "spark", "tulip", "planet",
      "bongo", "velvet", "cactus", "ribbon", "biscuit", "thunder", "marshmallow", "zigzag", "lantern", "pickle",
    ];
    const demoMessages = Array.from({length:30}, (_, index) => {
      const playerIndex = Math.floor(Math.random() * fruitNames.length);
      const words = Array.from({length:3 + Math.floor(Math.random() * 3)}, () => randomWords[Math.floor(Math.random() * randomWords.length)]);
      return {name:fruitNames[playerIndex], avatar:avatars[playerIndex], text:words.join(" "), time:index < 2 ? "now" : `${Math.ceil(index / 3)}m`};
    });
    for (const message of demoMessages) {
      const article = document.createElement("article");
      article.className = "chat-preview-message";
      const body = document.createElement("div");
      const meta = document.createElement("div");
      meta.className = "chat-message-meta";
      const name = document.createElement("strong");
      name.textContent = message.name;
      const stamp = document.createElement("time");
      stamp.textContent = message.time;
      const text = document.createElement("p");
      text.textContent = message.text;
      meta.append(name, stamp);
      body.append(meta, text);
      article.append(makeAvatar(message.avatar, "chat-avatar-photo"), body);
      log.append(article);
    }
  }

  const storageKey = "buildplay.arcade-chat-preview.v1";
  const savedMessages = () => {
    try {
      const messages = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      return Array.isArray(messages) ? messages.slice(-30) : [];
    } catch {
      return [];
    }
  };
  const appendMessage = ({ text, time }) => {
    const article = document.createElement("article");
    article.className = "chat-preview-message is-local-message";
    const avatar = document.createElement("span");
    avatar.className = "chat-avatar chat-avatar-blue";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "Y";
    const body = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "chat-message-meta";
    const name = document.createElement("strong");
    name.textContent = "You";
    const stamp = document.createElement("time");
    stamp.textContent = time;
    const message = document.createElement("p");
    message.textContent = text;
    meta.append(name, stamp);
    body.append(meta, message);
    article.append(avatar, body);
    log.append(article);
  };

  for (const message of savedMessages()) appendMessage(message);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const messages = savedMessages();
    const message = { text: text.slice(0, 240), time: "now" };
    messages.push(message);
    try { sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-30))); } catch {}
    appendMessage(message);
    input.value = "";
    log.scrollTop = log.scrollHeight;
    input.focus();
  });
})();
