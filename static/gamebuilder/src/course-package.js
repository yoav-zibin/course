// Translates GameBuilder's pure game object into the course's existing iframe API.
// No changes to the portal or backend contract are required.
const CoursePackage = (() => {
  function runtime() {
    const root = document.getElementById('root');
    const style = document.getElementById('game-style');
    const note = document.getElementById('note');
    let latest = null, state = null, ui = {}, waiting = true, timer = null;
    const clone = value => JSON.parse(JSON.stringify(value));
    function fail(error) {
      note.textContent = 'Game error: ' + error.message;
      note.hidden = false;
    }
    function send(next) {
      const result = game.result(clone(next));
      const turn = result ? null : game.currentPlayer(clone(next));
      waiting = true;
      parent.postMessage({ type: 'make_move', new_state: clone(next),
        next_turn_player_indices: turn === null ? null : [turn] }, '*');
    }
    function draw() {
      const viewer = latest.status === 'over' ? -1 : (latest.my_player_index ?? -1);
      const out = game.render(clone(state), viewer, ui);
      root.innerHTML = typeof out === 'string' ? out : out.html || '';
      style.textContent = typeof out === 'string' ? '' : out.css || '';
      const acting = latest.acting_for_player_index;
      root.classList.toggle('locked', waiting || latest.status !== 'ongoing' ||
        acting === null || acting !== latest.my_player_index ||
        acting !== game.currentPlayer(clone(state)));
    }
    function move(value) {
      const legal = game.legalMoves(clone(state));
      if (!legal.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))) {
        throw new Error('That move is not legal.');
      }
      send(game.applyMove(clone(state), clone(value), Math.random));
      draw();
    }
    window.addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== 'state_changed') return;
      clearTimeout(timer);
      latest = event.data;
      ui = {}; waiting = false; note.hidden = true;
      try {
        // Publish randomized initial state as a move, so every client shares it.
        if (latest.state === null) {
          root.replaceChildren();
          if (latest.status === 'ongoing' && latest.acting_for_player_index !== null) {
            send(game.init(latest.players.length, Math.random));
          }
          return;
        }
        state = clone(latest.state);
        draw();
        const acting = latest.acting_for_player_index;
        if (latest.status === 'ongoing' && acting !== null &&
            acting === game.currentPlayer(clone(state)) &&
            latest.players[acting]?.kind === 'computer') {
          timer = setTimeout(() => {
            try {
              const legal = game.legalMoves(clone(state));
              const choice = typeof game.computerMove === 'function'
                ? game.computerMove(clone(state), Math.random)
                : legal[Math.floor(Math.random() * legal.length)];
              move(choice);
            } catch (error) { fail(error); }
          }, 350);
        }
      } catch (error) { fail(error); }
    });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-move],[data-ui]');
      if (!button || button.disabled || waiting || !latest || latest.status !== 'ongoing' ||
          latest.acting_for_player_index === null ||
          latest.acting_for_player_index !== latest.my_player_index ||
          latest.acting_for_player_index !== game.currentPlayer(clone(state))) return;
      try {
        if (button.hasAttribute('data-ui')) {
          const change = JSON.parse(button.getAttribute('data-ui'));
          for (const [key, value] of Object.entries(change)) {
            if (value === null) delete ui[key]; else ui[key] = value;
          }
          draw();
        } else move(JSON.parse(button.getAttribute('data-move')));
      } catch (error) { fail(error); }
    });
    window.addEventListener('error', event => fail(new Error(event.message)));
  }

  function encode(document) {
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function unpack(code) {
    const match = /^<!--gamebuilder-v1:([A-Za-z0-9+/=]+)-->/.exec(code);
    if (!match) return null;
    try {
      const bytes = Uint8Array.from(atob(match[1]), c => c.charCodeAt(0));
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      return typeof doc.code === 'string' && typeof doc.title === 'string' &&
        typeof doc.localId === 'string' ? doc : null;
    } catch { return null; }
  }

  function pack(document) {
    const safeCode = document.code.replace(/<\/script/gi, '<\\/script');
    const css = ':root{--g-bg:#12150e;--g-surface:#23291c;--g-fg:#f6f8ed;--g-muted:#a9b19a;--g-line:#46523a;--g-accent:#c7f564;--g-accent-ink:#19230a;--g-board:#263c27;--g-p0:#8ab4ff;--g-p1:#ffb18a;--g-p2:#b8a2ff;--g-p3:#85e6b6;--g-p4:#ffd479;--g-p5:#ef9fd5;--g-p6:#6ed8e4;--g-p7:#d3b68d;--g-p8:#b1d775;--g-p9:#f99595;color-scheme:dark}body{margin:0;padding:12px;background:var(--g-bg);color:var(--g-fg);font:15px system-ui}button{font:inherit;color:inherit;cursor:pointer}.locked [data-move],.locked [data-ui]{pointer-events:none}[hidden]{display:none!important}';
    return '<!--gamebuilder-v1:' + encode(document) + '-->\n<!doctype html><html><head>' +
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">' +
      '<style>' + css + '</style><style id="game-style"></style></head><body>' +
      '<div id="root"></div><p id="note" hidden></p><script>' + safeCode + '\n(' +
      runtime.toString() + ')();</script></body></html>';
  }
  return { pack, unpack };
})();
if (typeof module !== 'undefined') module.exports = CoursePackage;
