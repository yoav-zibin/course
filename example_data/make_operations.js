// Writes operations.json: the steps that build the example data (users, games and
// matches in many states). Game states come from the games' own logic, loaded from
// ../games/*.html, so they are states the games can continue from.
//
// Run with Node.js 18+:   node example_data/make_operations.js
// then rebuild the data:  python -m game_platform.example_data
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const GAMES_DIR = path.join(__dirname, "..", "games");

function loadLogic(file) {
  const html = fs.readFileSync(path.join(GAMES_DIR, file), "utf8");
  const script = html.slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.Logic = Logic;`, context);
  return context.Logic;
}

const TicTacToe = loadLogic("tictactoe.html");
const Poker = loadLogic("poker.html");

// A seeded random generator, so the example data is the same on every run.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const operations = [];
const op = (operation) => operations.push(operation);

// Mirrors the platform's seat rules, to know who moves for each turn.
class MatchModel {
  constructor({ id, owner, game, computers = 0 }) {
    this.id = id;
    this.humans = [owner];
    this.computers = computers;
    this.seats = null; // set by start(); before that seats are humans then computers
    this.turn = null;
    this.state = null;
    op({ op: "create_match", id, as: owner, game, num_computer_opponents: computers });
  }

  currentSeats() {
    return this.seats ?? [
      ...this.humans.map((user) => ({ kind: "human", user })),
      ...Array(this.computers).fill({ kind: "computer", user: null }),
    ];
  }

  join(user) {
    if (this.seats) {
      const computer = this.seats.findIndex((seat) => seat.kind === "computer");
      if (computer >= 0) this.seats[computer] = { kind: "human", user };
      else this.seats.push({ kind: "human", user });
    } else {
      this.humans.push(user);
    }
    op({ op: "join", as: user, match: this.id });
  }

  setComputers(count) {
    this.computers = count;
    op({ op: "set_num_computer_opponents", as: this.humans[0], match: this.id, num_computer_opponents: count });
  }

  start() {
    this.seats = this.currentSeats().map((seat) => ({ ...seat }));
    this.turn = 0;
    op({ op: "start", as: this.humans[0], match: this.id });
  }

  /** Records a move for the seat whose turn it is; computers' moves are submitted by a human player. */
  move(newState, nextTurn) {
    const seat = this.seats[this.turn];
    const as = seat.kind === "human" ? seat.user : this.seats.find((s) => s.kind === "human").user;
    op({ op: "move", as, match: this.id, new_state: newState, next_turn_player_index: nextTurn });
    this.state = newState;
    this.turn = nextTurn;
  }

  leave(user) {
    op({ op: "leave", as: user, match: this.id });
    const index = this.seats.findIndex((seat) => seat.user === user);
    this.seats[index] = { kind: "computer", user: null };
  }

  hide(user) {
    op({ op: "delete_match", as: user, match: this.id });
  }

  seatKind(index) {
    return this.seats[index].kind;
  }
}

function playTicTacToe(match, cells) {
  for (const cell of cells) {
    const { state, nextTurn } = TicTacToe.play(match.state, match.turn, cell);
    match.move(state, nextTurn);
  }
}

/** Deals, then plays [actions] computer-strategy actions, then keeps playing until [until]. */
function playPoker(match, { seed, actions = 0, until = () => true, scripted = [] }) {
  const rng = seededRng(seed);
  const deal = Poker.newGame(match.seats.length, rng);
  match.move(deal, deal.to_act);
  const act = (action) => {
    const state = Poker.ensureSeats(match.state, match.seats.length);
    const { state: next, nextTurn } = Poker.act(state, match.turn, action, rng, names(match));
    match.move(next, nextTurn);
  };
  for (const action of scripted) act(action);
  for (let i = 0; match.turn !== null && (i < actions || !until(match)); i++) {
    const state = Poker.ensureSeats(match.state, match.seats.length);
    act(Poker.computerAction(state, match.turn, rng));
    if (i > 500) throw new Error(`${match.id}: didn't reach the wanted state`);
  }
}

function continuePoker(match, { seed, actions, until = () => true }) {
  const rng = seededRng(seed);
  for (let i = 0; match.turn !== null && (i < actions || !until(match)); i++) {
    const state = Poker.ensureSeats(match.state, match.seats.length);
    const { state: next, nextTurn } = Poker.act(state, match.turn, Poker.computerAction(state, match.turn, rng), rng, names(match));
    match.move(next, nextTurn);
    if (i > 500) throw new Error(`${match.id}: didn't reach the wanted state`);
  }
}

function names(match) {
  return match.seats.map((seat, index) => seat.user ?? `Computer ${index + 1}`);
}

const humanToMove = (match) => match.turn !== null && match.seatKind(match.turn) === "human";

// Users and games

const USERS = ["user1", "user2", "user3", "user4", "user5", "user6", "user7", "user8"];
for (const user of USERS) op({ op: "create_user", id: user, display_name: user, password: user });

op({
  op: "create_game", id: "tictactoe", as: "user1", name: "Tic-tac-toe",
  description: "Three in a row wins. X moves first.",
  allowed_player_counts: [2], allows_leave_mid_match: false, allows_join_mid_match: false,
  code_file: "tictactoe.html",
});
op({
  op: "create_game", id: "poker", as: "user1", name: "Poker",
  description: "No-limit Texas hold'em, 1000 chips each, blinds 10/20 doubling every 10 hands.",
  allowed_player_counts: [2, 3, 4, 5, 6, 7, 8], allows_leave_mid_match: true, allows_join_mid_match: true,
  code_file: "poker.html",
});
op({
  op: "create_game", id: "debug", as: "user1", name: "Debug game",
  description: "Shows every state_changed message and sends any make_move you enter.",
  allowed_player_counts: [2, 3, 4, 5, 6, 7, 8, 9, 10], allows_leave_mid_match: true, allows_join_mid_match: true,
  code_file: "debug.html",
});

// Tic-tac-toe matches

let m = new MatchModel({ id: "ttt-ongoing", owner: "user1", game: "tictactoe" });
m.join("user2");
m.start();
playTicTacToe(m, [4, 0, 8]); // user2 (O) to move

m = new MatchModel({ id: "ttt-vs-computer", owner: "user3", game: "tictactoe", computers: 1 });
m.start();
playTicTacToe(m, [0]);
playTicTacToe(m, [TicTacToe.computerCell(m.state, 1, seededRng(1))]); // user3 (X) to move

m = new MatchModel({ id: "ttt-computer-to-move", owner: "user6", game: "tictactoe", computers: 1 });
m.start();
playTicTacToe(m, [2]); // the computer (O) moves when user6 opens the match

m = new MatchModel({ id: "ttt-x-won", owner: "user2", game: "tictactoe" });
m.join("user4");
m.start();
playTicTacToe(m, [0, 3, 1, 4, 2]); // X (user2) wins on the top row
m.hide("user4"); // user4 hid it from their list

m = new MatchModel({ id: "ttt-draw", owner: "user5", game: "tictactoe" });
m.join("user6");
m.start();
playTicTacToe(m, [0, 4, 8, 2, 6, 3, 5, 7, 1]);

m = new MatchModel({ id: "ttt-computer-won", owner: "user7", game: "tictactoe", computers: 1 });
m.start();
{
  // user7 plays randomly and the computer perfectly: find a game the computer wins.
  const rng = seededRng(7);
  let cells;
  for (;;) {
    cells = [];
    let state = null;
    let turn = 0;
    while (turn !== null) {
      const empty = (state ?? TicTacToe.initialState()).board.flatMap((mark, c) => (mark ? [] : [c]));
      const cell = turn === 0 ? empty[Math.floor(rng() * empty.length)] : TicTacToe.computerCell(state, 1, rng);
      cells.push(cell);
      ({ state, nextTurn: turn } = TicTacToe.play(state, turn, cell));
    }
    if (state.winner === 1) break;
  }
  playTicTacToe(m, cells);
}

m = new MatchModel({ id: "ttt-player-left", owner: "user1", game: "tictactoe" });
m.join("user3");
m.start();
playTicTacToe(m, [4, 2]);
m.leave("user3"); // tic-tac-toe doesn't allow leaving, so the match ended

new MatchModel({ id: "ttt-waiting", owner: "user4", game: "tictactoe" }); // needs a second player

new MatchModel({ id: "ttt-ready", owner: "user8", game: "tictactoe", computers: 1 }); // ready to start

// Poker matches. The first two use version 1 of the game; then its description changes.

m = new MatchModel({ id: "poker-heads-up", owner: "user1", game: "poker" });
m.join("user2");
m.start();
playPoker(m, { seed: 11, actions: 3, until: humanToMove });

m = new MatchModel({ id: "poker-four-on-the-flop", owner: "user3", game: "poker", computers: 1 });
m.join("user4");
m.join("user5");
m.start();
playPoker(m, { seed: 12, until: (match) => match.state.street === "flop" && humanToMove(match) });

op({
  op: "update_game", as: "user1", game: "poker",
  description: "No-limit Texas hold'em: 1000 chips each, blinds 10/20 doubling every 10 hands. Last player with chips wins.",
});

m = new MatchModel({ id: "poker-full-table", owner: "user1", game: "poker" });
for (const user of ["user2", "user3", "user4", "user5", "user6", "user7", "user8"]) m.join(user);
m.start();
playPoker(m, { seed: 13, actions: 6, until: humanToMove });

m = new MatchModel({ id: "poker-player-left", owner: "user6", game: "poker" });
m.join("user7");
m.join("user8");
m.start();
playPoker(m, { seed: 14, actions: 4 });
m.leave("user6"); // a computer took over user6's seat, keeping the chips
continuePoker(m, { seed: 15, actions: 1, until: humanToMove });

m = new MatchModel({ id: "poker-player-joined", owner: "user2", game: "poker" });
m.join("user3");
m.start();
playPoker(m, { seed: 16, actions: 2 });
m.join("user4"); // a new seat: user4 plays from the next hand
continuePoker(m, { seed: 17, actions: 4, until: (match) => match.state.hand_number >= 2 && humanToMove(match) });

m = new MatchModel({ id: "poker-took-over-computer", owner: "user5", game: "poker", computers: 2 });
m.start();
playPoker(m, { seed: 18, actions: 3 });
m.join("user1"); // user1 took over the first computer's seat
continuePoker(m, { seed: 19, actions: 1, until: humanToMove });

m = new MatchModel({ id: "poker-over", owner: "user2", game: "poker", computers: 1 });
m.start();
// Both go all in on the first hand; whoever loses has no chips left.
playPoker(m, {
  seed: 20,
  scripted: [{ type: "raise", to: Poker.STARTING_CHIPS }, { type: "call" }],
});
if (m.turn !== null) throw new Error("poker-over should have ended");

m = new MatchModel({ id: "poker-last-human-left", owner: "user4", game: "poker", computers: 1 });
m.start();
playPoker(m, { seed: 21, actions: 2, until: humanToMove });
m.leave("user4"); // only computers were left, so the match ended

m = new MatchModel({ id: "poker-ready", owner: "user5", game: "poker" });
m.join("user6");
m.setComputers(2); // four players: ready to start

new MatchModel({ id: "poker-open", owner: "user7", game: "poker" }); // waiting for someone to join

// Debug game matches

new MatchModel({ id: "debug-waiting", owner: "user1", game: "debug" });

m = new MatchModel({ id: "debug-ongoing", owner: "user1", game: "debug" });
m.join("user2");
m.join("user3");
m.start();
m.move({ counter: 1, note: "user1 moved" }, 1);
m.move({ counter: 2, note: "user2 moved" }, 2);
m.move({ counter: 3, note: "user3 moved; back to user1" }, 0);

m = new MatchModel({ id: "debug-computer-to-move", owner: "user4", game: "debug", computers: 1 });
m.start();
m.move({ counter: 1, note: "user4 passed the turn to the computer" }, 1); // user4 moves for it

m = new MatchModel({ id: "debug-over", owner: "user5", game: "debug" });
m.join("user6");
m.start();
m.move({ counter: 1, note: "user5 moved" }, 1);
m.move({ counter: 2, note: "user6 ended the match" }, null);

const output = path.join(__dirname, "operations.json");
fs.writeFileSync(output, `${JSON.stringify(operations, null, 1)}\n`);
console.log(`wrote ${operations.length} operations to ${output}`);
