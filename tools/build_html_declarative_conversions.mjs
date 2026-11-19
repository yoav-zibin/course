#!/usr/bin/env node
// Build portable declarative editions of ten existing HTML catalog games.
// The original server modules stay authoritative; only legal choices are
// surfaced to the shared portal renderer.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'games', 'declarative');
const SOURCE_UI = fs.readFileSync(path.join(ROOT, 'games/declarative/html_conversions_ui.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/leave_contract/catalog.json'), 'utf8'));
const languages = ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar'];
const entries = [
  {kind:'battleship', source:'Battleship', file:'games/audit-batch1/battleship.server.js', players:[2],
    rules:'Place a fleet of five ships, then take turns firing at hidden waters. A hit earns another shot; sink the opposing fleet to win.',
    ui:'Place the offered valid fleet, then tap an untried target cell. Your fleet and shots remain visible on separate boards.'},
  {kind:'checkers', source:'Checkers', file:'games/audit-batch4/checkers.server.js', players:[2],
    rules:'Move diagonally, capture opposing pieces by jumping, and reach the far side to crown a king. Captures are mandatory and a capture chain must be completed.',
    ui:'Tap one of the highlighted legal destinations. Crowns, required captures, and continuing jumps are shown from the server view.'},
  {kind:'chess', source:'Chess', file:'games/audit-batch5/chess.server.js', players:[2],
    rules:'Move by standard chess rules. Checkmate wins; stalemate, threefold repetition, the 50-move rule, and insufficient material draw.',
    ui:'Tap a highlighted legal destination. Promotion choices are shown on the destination, and the server validates every move.'},
  {kind:'four_player_chess', source:'4 player chess', file:'games/audit-batch2/4-player-chess.server.js', players:[4],
    rules:'Four players move around a shared cross-shaped chessboard. Capture opposing pieces and protect your king; the server determines legal moves and team victory.',
    ui:'Tap a highlighted legal destination on the shared board. Player colors, eliminated armies, checks, and the winning team remain visible.'},
  {kind:'quoridor', source:'Quoridor', file:'games/audit-batch2/quoridor.server.js', players:[2],
    rules:'Race your pawn to the opposite edge. Move one square or place a wall each turn; walls may slow a rival but may never block every route.',
    ui:'Choose Move pawn or Place wall, then tap a highlighted legal square or wall anchor. The board shows both pawns and all placed walls.'},
  {kind:'crazy_eights', source:'Crazy Eights', file:'games/audit-batch1/crazy-eights.server.js', players:[2,3,4],
    rules:'Play a card matching the discard pile by rank or suit, or play an eight and choose a new suit. If no card is played, draw. Empty your hand to win.',
    ui:'Tap a playable card or choose its action button. Eights offer four suit choices; Draw remains available when you need another card.'},
  {kind:'go_fish', source:'Go Fish', file:'games/audit-batch1/go-fish.server.js', players:[2,3,4,5,6],
    rules:'Ask another player for a rank that you hold. Collected sets of four become books. If they have none, draw from the deck; the most books wins.',
    ui:'Choose a rank and opponent from the offered Ask buttons. Your hand and completed books are shown, while other hands stay hidden.'},
  {kind:'hearts', source:'Hearts', file:'games/audit-batch4/hearts.server.js', players:[4],
    rules:'Follow the led suit when possible. Hearts are worth one point and the queen of spades is worth thirteen. The lowest score wins after thirteen tricks.',
    ui:'Tap one of the legal cards highlighted in your hand. The trick, score totals, and whether hearts have been broken are visible.'},
  {kind:'spades', source:'Spades', file:'games/audit-batch5/spades.server.js', players:[4],
    rules:'Play one card to each trick, following suit when possible. Spades are trump; the highest trump or led-suit card wins. Collect the completed trick.',
    ui:'Tap a card from your private hand. Follow-suit choices are offered; the trick winner collects the four played cards.'},
  {kind:'guess_who', source:'Guess Who?', file:'games/audit-batch5/guess-who.server.js', players:[2],
    rules:'Ask yes-or-no questions about the other player’s secret character, then guess their identity. A correct guess wins; an incorrect guess loses.',
    ui:'Choose a question or tap a character to make a guess. Your secret character and question history are shown only to you.'}
];

const TITLE_TRANSLATIONS = {
  battleship: ['Acorazado', 'Bataille navale', 'Schiffe versenken', 'Batalha naval', '战舰', 'युद्धपोत', 'سفن حربية'],
  checkers: ['Damas', 'Dames', 'Dame', 'Damas', '跳棋', 'चेकर्स', 'الداما'],
  chess: ['Ajedrez', 'Échecs', 'Schach', 'Xadrez', '国际象棋', 'शतरंज', 'الشطرنج'],
  four_player_chess: ['Ajedrez para cuatro', 'Échecs à quatre', 'Vierpersonenschach', 'Xadrez para quatro', '四人国际象棋', 'चार खिलाड़ी शतरंज', 'شطرنج لأربعة لاعبين'],
  quoridor: ['Quoridor', 'Quoridor', 'Quoridor', 'Quoridor', 'Quoridor', 'क्वोरिडोर', 'كوريدور'],
  crazy_eights: ['Ocho loco', 'Huit américain', 'Crazy Eights', 'Oito maluco', '疯狂八', 'क्रेज़ी एट्स', 'الثمانية المجنونة'],
  go_fish: ['Ve a pescar', 'Va pêcher', 'Go Fish', 'Pesca', '钓鱼', 'गो फिश', 'اذهب للصيد'],
  hearts: ['Corazones', 'Cœurs', 'Herz', 'Copas', '红心大战', 'हार्ट्स', 'قلوب'],
  spades: ['Picas', 'Pique', 'Pik', 'Espadas', '黑桃', 'स्पेड्स', 'سبيدز'],
  guess_who: ['Adivina quién', 'Qui est-ce ?', 'Wer ist es?', 'Quem é?', '猜猜我是谁', 'कौन है?', 'من أنا؟']
};

// Keep server-authored messages in the package string table so the portal can
// translate the errors and status messages emitted by each existing ruleset.
const SERVER_TEMPLATES = {
  battleship: ['unknown player','game over','bad move','place your ships','setup done','not your setup turn','fire with x,y','not your turn','off board','already shot there','bad phase','Battle start! P1 fires. HIT keeps your turn!'],
  checkers: ['Game is over','Not your turn','Bad move','Off board','You must capture','Illegal move'],
  chess: ['game over','unknown player','not your turn','not your piece','illegal move','Checkmate','Stalemate','50-move rule','Insufficient material','Move limit','Threefold repetition','Resignation — no possible mate','Resignation'],
  four_player_chess: ['unknown player','game over','illegal move','moves available','unknown move'],
  quoridor: ['game over','not seated','not your turn','bad move','bad square','illegal pawn move','bad wall','no walls left','illegal wall','unknown move'],
  crazy_eights: ['Match is over','Not your turn','Illegal card','Choose a suit','Card not in hand','Unknown move'],
  go_fish: ['unknown player','empty hand: refill first','you have no cards: pass','pick a rank and opponent','bad opponent','cannot ask yourself','bad rank','you hold no {p1}s','{p1} refilled +{p2}','{p1} passes','{p1} got {p2} {p3} from {p4}','{p1} asked {p2} for {p3}s — Go Fish!','📊 Book(s): {p1}','got {p1} {p2}','fished the {p1}','go fish','go fish (empty)'],
  hearts: ['game over','unknown player','not your turn','pick a card','card not in hand','illegal play'],
  spades: ['game over','unknown player','bad move','bad ai mode','not your collect','must collect','nothing to collect','not your turn','trick full','pick a card','not your card'],
  guess_who: ['unknown player','game over','bad move','bad question','already asked','bad guess','unknown move']
};

function sourceStrings(entry) {
  const strings = {title:entry.source + ' (Declarative)'};
  for (const text of SERVER_TEMPLATES[entry.kind] || []) {
    const base = `server_${text.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')}`;
    let key = base, suffix = 2;
    while (Object.hasOwn(strings,key) && strings[key] !== text) key = `${base}_${suffix++}`;
    strings[key] = text;
  }
  return strings;
}

const COLORS = ['#e45757', '#4388d1', '#9b65c9', '#35a979', '#dc8b39', '#21a8a0'];
const TYPES = {
  p0:{shape:'circle',width:50,height:50,color:'#4aa3ff',text_color:'#10243d'},
  p1:{shape:'circle',width:50,height:50,color:'#fb7185',text_color:'#39101c'},
  king_p0:{shape:'circle',width:50,height:50,color:'#4aa3ff',text_color:'#ffffff'},
  king_p1:{shape:'circle',width:50,height:50,color:'#fb7185',text_color:'#ffffff'},
  white_piece:{shape:'text',width:52,height:52,color:'#f8fafc',text_color:'#101827'},
  black_piece:{shape:'text',width:52,height:52,color:'#1f2937',text_color:'#f8fafc'},
  seat_0:{shape:'text',width:38,height:38,color:'#ef4444',text_color:'#ffffff'},
  seat_1:{shape:'text',width:38,height:38,color:'#3b82f6',text_color:'#ffffff'},
  seat_2:{shape:'text',width:38,height:38,color:'#22c55e',text_color:'#102814'},
  seat_3:{shape:'text',width:38,height:38,color:'#a855f7',text_color:'#ffffff'},
  square:{shape:'rect',width:42,height:42,color:'#dce5ef',text_color:'#243244'},
  square_light:{shape:'rect',width:42,height:42,color:'#e7edf4',text_color:'#243244'},
  square_dark:{shape:'rect',width:42,height:42,color:'#73869c',text_color:'#ffffff'},
  pawn:{shape:'circle',width:34,height:34,color:'#4aa3ff',text_color:'#10243d'},
  pawn_red:{shape:'circle',width:34,height:34,color:'#fb7185',text_color:'#39101c'},
  card:{shape:'card',width:60,height:80,color:'#fffdf6',text_color:'#172033',border_color:'#667085'},
  played:{shape:'card',width:58,height:78,color:'#fffdf6',text_color:'#172033',border_color:'#667085'},
  mark_water:{shape:'circle',width:28,height:28,color:'#2770a8',text_color:'#ffffff'},
  mark_ship:{shape:'rect',width:28,height:28,color:'#a9b5c4',text_color:'#1f2937'},
  mark_hit:{shape:'circle',width:28,height:28,color:'#e45757',text_color:'#ffffff'},
  mark_miss:{shape:'circle',width:28,height:28,color:'#e2e8f0',text_color:'#334155'},
  ...Object.fromEntries(COLORS.map((color, i) => [`person_${i}`, {shape:'card',width:82,height:78,color,text_color:'#ffffff',border_color:'#ffffff'}]))
};

function playerSource(name) {
  return catalog.find(entry => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase());
}

function addServerPresentationData(kind, code, schemas) {
  if (kind === 'battleship') {
    return code + `\n;(() => {\n  const original = game.computerMove;\n  game.computerMove = function(state, playerId, ctx) {\n    if (state.phase === 'SETUP') return {type:'place',ships:[\n      {name:'Carrier',cells:[[0,0],[1,0],[2,0],[3,0],[4,0]]},\n      {name:'Battleship',cells:[[0,2],[1,2],[2,2],[3,2]]},\n      {name:'Cruiser',cells:[[0,4],[1,4],[2,4]]},\n      {name:'Submarine',cells:[[0,6],[1,6],[2,6]]},\n      {name:'Destroyer',cells:[[0,8],[1,8]]}]};\n    return original.call(this,state,playerId,ctx);\n  };\n})();`;
  }
  if (kind === 'chess') {
    schemas.view.properties.legalMoves = {type:'array',maxItems:256,items:{
      type:'object',required:['fr','fc','tr','tc'],additionalProperties:false,
      properties:{fr:{type:'integer',minimum:0,maximum:7},fc:{type:'integer',minimum:0,maximum:7},
        tr:{type:'integer',minimum:0,maximum:7},tc:{type:'integer',minimum:0,maximum:7},
        promo:{enum:['Q','R','B','N']}}}};
    return code + `\n;(() => {\n  const original = game.viewFor;\n  game.viewFor = function(state, playerId, ctx) {\n    const view = original.call(this,state,playerId,ctx);\n    const seat = playerId == null ? -1 : ctx.players.findIndex(p => p.id === playerId);\n    view.legalMoves = seat >= 0 && state.winner === null ? allLegal(state,state.turn).map(cleanMove) : [];\n    return view;\n  };\n})();`;
  }
  if (kind === 'quoridor') {
    schemas.view.properties.legalWalls = {type:'array',maxItems:128,items:{
      type:'object',required:['r','c','o'],additionalProperties:false,
      properties:{r:{type:'integer',minimum:0,maximum:7},c:{type:'integer',minimum:0,maximum:7},o:{enum:['H','V']}}}};
    return code + `\n;(() => {\n  const original = game.viewFor;\n  game.viewFor = function(state, playerId, ctx) {\n    const view = original.call(this,state,playerId,ctx);\n    const seat = playerId == null ? -1 : this.idxOf(state,playerId,ctx);\n    view.legalWalls = [];\n    if (seat >= 0 && seat === state.turnIdx && state.winner == null && (state.wallsLeft[seat] || 0) > 0) {\n      for (let r=0;r<8;r++) for (let c=0;c<8;c++) for (const o of ['H','V'])\n        if (this.wallFits(state,r,c,o)) view.legalWalls.push({r,c,o});\n    }\n    return view;\n  };\n})();`;
  }
  return code;
}

function boardFor(kind) {
  const base = {color:'#dbe4ef', alternate_color:'#8ea1b8', line_color:'#64748b'};
  if (kind === 'battleship') return {viewport:{width:800,height:640},boards:[
    {id:'own',kind:'grid',x:20,y:130,width:360,height:360,rows:10,columns:10,color:'#286a9c',alternate_color:'#337eb3',line_color:'#183d5b'},
    {id:'target',kind:'grid',x:420,y:130,width:360,height:360,rows:10,columns:10,color:'#286a9c',alternate_color:'#337eb3',line_color:'#183d5b'}]};
  if (kind === 'checkers') return {viewport:{width:600,height:680},boards:[{id:'main',kind:'grid',x:20,y:96,width:560,height:560,rows:8,columns:8,...base}]};
  if (kind === 'chess') return {viewport:{width:600,height:680},boards:[{id:'main',kind:'grid',x:20,y:96,width:560,height:560,rows:8,columns:8,...base}]};
  if (kind === 'four_player_chess') return {viewport:{width:650,height:720},boards:[{id:'main',kind:'free',x:30,y:95,width:588,height:588,color:'#f8fafc',line_color:'#cbd5e1'}]};
  if (kind === 'quoridor') return {viewport:{width:580,height:700},boards:[{id:'main',kind:'free',x:0,y:0,width:570,height:680,color:'#f8fafc',line_color:'#cbd5e1'}]};
  if (kind === 'guess_who') return {viewport:{width:600,height:680},boards:[{id:'main',kind:'grid',x:15,y:130,width:570,height:380,rows:4,columns:6,...base}]};
  return {viewport:{width:600,height:680},boards:[{id:'table',kind:'free',x:0,y:0,width:600,height:680,color:'#145b4e',line_color:'#6ee7b7'}]};
}

function makeSpec(entry) {
  const layout = boardFor(entry.kind);
  const typeNames = entry.kind === 'checkers' ? ['p0','p1','king_p0','king_p1'] :
    entry.kind === 'chess' ? ['white_piece','black_piece'] :
    entry.kind === 'four_player_chess' ? ['seat_0','seat_1','seat_2','seat_3','square_light','square_dark'] :
    entry.kind === 'quoridor' ? ['square','p0','p1'] :
    entry.kind === 'battleship' ? ['mark_water','mark_ship','mark_hit','mark_miss'] :
    entry.kind === 'guess_who' ? CHARACTER_TYPES : ['card','played'];
  const typeValues = {};
  for (const name of typeNames) typeValues[name] = TYPES[name];
  if (entry.kind === 'quoridor') { typeValues.p0 = TYPES.pawn; typeValues.p1 = TYPES.pawn_red; }
  const strings = sourceStrings(entry);
  return {format:'buildplay-ui',version:1,viewport:layout.viewport,boards:layout.boards,
    piece_types:typeValues,strings,
    ui_code:`const KIND=${JSON.stringify(entry.kind)};\nconst SOURCE_STRINGS=${JSON.stringify({title:strings.title})};\n` + SOURCE_UI};
}

const CHARACTER_TYPES = ['person_0','person_1','person_2','person_3','person_4','person_5'];

function safeDeckArt(kind, index) {
  const colors = ['#17324f','#2770a8','#56c9b4','#ffbf66'];
  if (index === 0) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${colors[index]}"/><circle cx="800" cy="450" r="230" fill="#dbeafe"/><circle cx="800" cy="450" r="150" fill="${colors[2]}"/><path d="M520 450h560M800 170v560" stroke="#ffffff" stroke-width="28" opacity=".75"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" rx="24" fill="${colors[index]}"/><circle cx="400" cy="300" r="150" fill="#ffffff" opacity=".86"/><path d="M280 300h240M400 180v240" stroke="${colors[(index+1)%colors.length]}" stroke-width="26"/></svg>`;
}

function image(caption, svg) { return {caption,svg}; }
function allImages(kind) {
  return [image('Cover',safeDeckArt(kind,0)),image('Initial board',safeDeckArt(kind,1)),
    image('Playable choices',safeDeckArt(kind,2)),image('Game in progress',safeDeckArt(kind,3))];
}

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleCase(entry, code, schemas) {
  const count = Math.min(...entry.players);
  const players = Array.from({length:count}, (_, i) => ({id:`u${i+1}`,kind:'human',display_name:['Alice','Bob','Casey','Drew','Evan','Fran'][i],
    picture_url:'',max_loss:0,active:true}));
  const ctx = {players,pot:0,move_count:0};
  const math = Object.create(Math);
  const sandbox = {InvalidMove:class InvalidMove extends Error{},Math:math,
    Date:class extends Date { static now(){ return 0; } }, console};
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.__convertedGame = game;',sandbox);
  const game = sandbox.__convertedGame;
  function call(name, ...args) {
    const rnd = randomFor(11);
    ctx.random = rnd; math.random = rnd;
    return JSON.parse(JSON.stringify(game[name](...args,ctx)));
  }
  const first = call('newMatch');
  const mover = first.turn && first.turn[0];
  if (!mover) throw new Error(`${entry.kind}: no starting player`);
  const moveSeed = 17;
  const rnd = randomFor(moveSeed); ctx.random = rnd; math.random = rnd;
  const move = game.computerMove ? game.computerMove(first.state,mover,ctx) : game.randomMove(first.state,mover,ctx);
  const cleanMove = JSON.parse(JSON.stringify(move));
  if (entry.kind === 'chess' && cleanMove && cleanMove.promo === null) delete cleanMove.promo;
  const before = call('viewFor',first.state,mover);
  const other = call('viewFor',first.state,null);
  ctx.move_count = 0;
  ctx.random = randomFor(11); math.random = ctx.random;
  const afterResult = JSON.parse(JSON.stringify(game.applyMove(JSON.parse(JSON.stringify(first.state)),mover,cleanMove,ctx)));
  ctx.move_count = 1;
  const afterMover = call('viewFor',afterResult.state,mover);
  const afterOther = call('viewFor',afterResult.state,null);
  const svg = safeDeckArt(entry.kind,1);
  const caseImages = ['Before: player','Before: spectator','After: player','After: spectator'].map(caption=>image(caption,svg));
  const exampleCtx = {players,pot:0,move_count:0,seed:11};
  return {name:'Opening move',description:entry.rules,kind:'initial',ctx:exampleCtx,
    state:first.state,view_of_mover:before,view_of_other:other,player_id:mover,other_player_id:null,move:cleanMove,
    expected_state:afterResult.state,expected_turn:afterResult.turn,expected_view_of_mover:afterMover,
    expected_view_of_other:afterOther,images:caseImages,...(afterResult.payouts ? {expected_payouts:afterResult.payouts} : {})};
}

function packageFor(entry) {
  const source = playerSource(entry.source);
  if (!source) throw new Error(`No server schema fixture found for ${entry.source}`);
  const schemas = structuredClone(source.game_schemas);
  let code = fs.readFileSync(path.join(ROOT,entry.file),'utf8');
  code = addServerPresentationData(entry.kind,code,schemas);
  const spec = makeSpec(entry);
  const example = sampleCase(entry,code,schemas);
  const title = `${entry.source} (Declarative)`;
  const tutorials = `<meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>${title}</h1><p>${entry.rules}</p><p>${entry.ui}</p></main>`;
  const translations = {};
  for (let i=0;i<languages.length;i++) {
    const locale = languages[i], translatedTitle = `${TITLE_TRANSLATIONS[entry.kind][i]} (Declarative)`;
    translations[locale] = {display_name:translatedTitle,short_description:entry.rules,
      game_logic_rules:entry.rules,game_ui_rules:entry.ui,
      tutorial_strings:{[entry.rules]:entry.rules},client_strings:{title:translatedTitle}};
  }
  const payload = {name:title,description:entry.rules,allowed_player_counts:entry.players,
    allows_leave_mid_match:source.allows_leave_mid_match,allows_join_mid_match:source.allows_join_mid_match,
    server_code:code,rules:entry.rules,ui_instructions:entry.ui,
    tutorial:{text:entry.rules,html:tutorials},images:allImages(entry.kind),
    unit_tests:{state_schema:schemas.state,move_schema:schemas.move,view_schema:schemas.view,cases:[example]},
    translations,game_addition_request_id_and_secret:`example-only-html-to-declarative-${entry.kind}-replace-before-publishing`,
    declarative_ui:spec};
  const filename = path.join(OUT,`${entry.kind}.json`);
  fs.writeFileSync(filename,JSON.stringify(payload,null,2)+'\n');
  console.log(`${entry.kind}: ${Buffer.byteLength(JSON.stringify(payload))} bytes`);
}

for (const entry of entries) packageFor(entry);
