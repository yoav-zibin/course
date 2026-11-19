#!/usr/bin/env node
// Build portable declarative editions of ten existing HTML catalog games.
// The checked-in packages retain their original rules and schemas. Regenerate
// their presentation without relying on untracked legacy export directories.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'games', 'declarative');
const SOURCE_UI = fs.readFileSync(path.join(ROOT, 'games/declarative/html_conversions_ui.js'), 'utf8');
const COPY = JSON.parse(fs.readFileSync(path.join(OUT,'locales/html_conversions.json'),'utf8'));
const STRING_KEYS = Object.fromEntries(Object.keys(COPY.strings).map((text,index)=>[text,`text_${index}`]));
const ENGLISH = Object.fromEntries(Object.entries(STRING_KEYS).map(([text,key])=>[key,text]));
const languages = ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar'];
const entries = [
  {kind:'battleship', source:'Battleship', players:[2],
    rules:'Place a fleet of five ships, then take turns firing at hidden waters. A hit earns another shot; sink the opposing fleet to win.',
    ui:'Place the offered valid fleet, then tap an untried target cell. Your fleet and shots remain visible on separate boards.'},
  {kind:'checkers', source:'Checkers', players:[2],
    rules:'Move diagonally, capture opposing pieces by jumping, and reach the far side to crown a king. Captures are mandatory and a capture chain must be completed.',
    ui:'Select a highlighted piece, then tap its legal destination. Crowns, required captures, and continuing jumps are shown from the server view.'},
  {kind:'chess', source:'Chess', players:[2],
    rules:'Move by standard chess rules. Checkmate wins; stalemate, threefold repetition, the 50-move rule, and insufficient material draw.',
    ui:'Select a highlighted piece, then its legal destination. Choose a promotion when offered; the server validates every move.'},
  {kind:'four_player_chess', source:'4 player chess', players:[4],
    rules:'Four players move around a shared cross-shaped chessboard. Capture opposing pieces and protect your king; the server determines legal moves and team victory.',
    ui:'Select a highlighted piece, then its legal destination on the shared board. Player colors, eliminated armies, checks, and the winning team remain visible.'},
  {kind:'quoridor', source:'Quoridor', players:[2],
    rules:'Race your pawn to the opposite edge. Move one square or place a wall each turn; walls may slow a rival but may never block every route.',
    ui:'Choose Move pawn or Place wall, then tap a highlighted legal square or wall anchor. The board shows both pawns and all placed walls.'},
  {kind:'crazy_eights', source:'Crazy Eights', players:[2,3,4],
    rules:'Play a card matching the discard pile by rank or suit, or play an eight and choose a new suit. If no card is played, draw. Empty your hand to win.',
    ui:'Tap a playable card or choose its action button. Eights offer four suit choices; Draw remains available when you need another card.'},
  {kind:'go_fish', source:'Go Fish', players:[2,3,4,5,6],
    rules:'Ask another player for a rank that you hold. Collected sets of four become books. If they have none, draw from the deck; the most books wins.',
    ui:'Choose a rank and opponent from the offered Ask buttons. Your hand and completed books are shown, while other hands stay hidden.'},
  {kind:'hearts', source:'Hearts', players:[4],
    rules:'Follow the led suit when possible. Hearts are worth one point and the queen of spades is worth thirteen. The lowest score wins after thirteen tricks.',
    ui:'Tap one of the legal cards highlighted in your hand. The trick, score totals, and whether hearts have been broken are visible.'},
  {kind:'spades', source:'Spades', players:[4],
    rules:'Play one card to each trick. Spades are trump; the highest trump or led-suit card wins. Collect completed tricks to score.',
    ui:'Tap a card from your hand to play it. The trick winner collects the completed trick.'},
  {kind:'guess_who', source:'Guess Who?', players:[2],
    rules:'Ask yes-or-no questions about the other player’s secret character, then guess their identity. A correct guess wins; an incorrect guess loses.',
    ui:'Choose a question or tap a character to make a guess. Your secret character stays private during play; question history is public.'}
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
};

function repairLegacySettlement(kind, code) {
  if (kind !== 'quoridor' || code.includes('// declarative-quoridor-settlement')) return code;
  return code + `
// declarative-quoridor-settlement
;(() => {
  const legacy = game.playerLeft;
  game.playerLeft = function(state, playerId, ctx) {
    let recorded = state._declarative_leave_payouts;
    if (!recorded && state.winner != null) recorded = this.payoutsFor(state.winner,ctx);
    if (!recorded) {
      const result = legacy.call(this,state,playerId,ctx);
      const humans = ctx.players.filter(p=>p.kind==='human' && p.active!==false);
      const others = humans.filter(p=>p.id!==playerId);
      const amount = others.length ? Math.max(0,Math.min(ctx.pot,result.payout||0)) : ctx.pot;
      recorded = {[playerId]:amount};
      const share = others.length ? Math.floor((ctx.pot-amount)/others.length) : 0;
      const extra = ctx.pot-amount-share*others.length;
      others.forEach((p,i)=>{recorded[p.id]=share+(i<extra?1:0);});
      state = {...result.state,winner:this.idxOf(state,playerId,ctx)===0?1:0,_declarative_leave_payouts:recorded};
    }
    // A later leave preserves the terminal snapshot and never reprices it.
    const active = ctx.players.filter(p=>p.kind==='human' && p.active!==false);
    const payouts = Object.fromEntries(active.map(p=>[p.id,recorded[p.id]||0]));
    const remaining = ctx.pot-Object.values(payouts).reduce((sum,value)=>sum+value,0);
    if (active.length) {
      const share = Math.floor(remaining/active.length),extra = remaining-share*active.length;
      active.forEach((p,i)=>{payouts[p.id]+=share+(i<extra?1:0);});
    }
    return {state,turn:null,payouts};
  };
})();`;
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
    entry.kind === 'guess_who' ? [] : ['card','played'];
  const typeValues = {};
  for (const name of typeNames) typeValues[name] = TYPES[name];
  if (entry.kind === 'quoridor') { typeValues.p0 = TYPES.pawn; typeValues.p1 = TYPES.pawn_red; }
  return {format:'buildplay-ui',version:1,viewport:layout.viewport,boards:layout.boards,
    piece_types:typeValues,strings:{...ENGLISH,...sourceStrings(entry)},
    ui_code:`const KIND=${JSON.stringify(entry.kind)};\nconst SOURCE_STRINGS=${JSON.stringify({title:entry.source + ' (Declarative)'})};\nconst SOURCE_KEYS=${JSON.stringify(STRING_KEYS)};\n` + SOURCE_UI};
}


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

function sampleCases(entry, code) {
  const players = Array.from({length:Math.min(...entry.players)}, (_, i) => ({id:`u${i+1}`,kind:'human',
    display_name:['Alice','Bob','Casey','Drew','Evan','Fran'][i],picture_url:'',max_loss:0,active:true}));
  const ctx = {players,pot:0,move_count:0};
  const math = Object.create(Math);
  const sandbox = {InvalidMove:class InvalidMove extends Error{},Math:math,
    Date:class extends Date { static now(){ return 0; } }};
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.__convertedGame = game;',sandbox,{timeout:1000});
  const game = sandbox.__convertedGame, clone = value=>JSON.parse(JSON.stringify(value));
  function call(name, args, seed) {
    ctx.random = randomFor(seed); math.random = ctx.random;
    return clone(game[name](...args,ctx));
  }
  const cases = [];
  let current = call('newMatch',[],11);
  for (let step=0;step<1000;step++) {
    ctx.move_count = step;
    const seed = 11+step, mover = current.turn?.[0], before = clone(current.state);
    if (!mover) throw new Error(`${entry.kind}: cannot derive a continuing example`);
    const move = call(game.computerMove?'computerMove':'randomMove',[clone(before),mover],17+step);
    if (entry.kind === 'chess' && move?.promo === null) delete move.promo;
    const viewOfMover = call('viewFor',[clone(before),mover],seed);
    const viewOfOther = call('viewFor',[clone(before),null],seed);
    const result = call('applyMove',[clone(before),mover,move],seed);
    const kind = step===0?'initial':result.turn===null?'terminal':step===1?'intermediate':null;
    if (kind) {
      const caseCtx = {players,pot:0,move_count:step,seed};
      ctx.move_count++;
      cases.push({name:{initial:'Opening move',intermediate:'Continuing match',terminal:'Finishing move'}[kind],
        description:entry.rules,kind,ctx:caseCtx,state:before,view_of_mover:viewOfMover,view_of_other:viewOfOther,
        player_id:mover,other_player_id:null,move,expected_state:result.state,expected_turn:result.turn,
        expected_view_of_mover:call('viewFor',[clone(result.state),mover],seed),
        expected_view_of_other:call('viewFor',[clone(result.state),null],seed),
        images:['Before: player','Before: spectator','After: player','After: spectator'].map(caption=>image(caption,safeDeckArt(entry.kind,1))),
        ...(result.payouts?{expected_payouts:result.payouts}:{})});
    }
    if (result.turn===null) {
      if (cases.length!==3) throw new Error(`${entry.kind}: expected opening, continuing and terminal cases`);
      return cases;
    }
    current = result;
  }
  throw new Error(`${entry.kind}: no terminal example within 1000 moves`);
}

function addCharacterPortraits(spec, code) {
  // The character catalogue is public; secret choices never enter these assets.
  const people = vm.runInNewContext(code + '\n;game.chars;', {}, {timeout:1000});
  const names = vm.runInNewContext(SOURCE_UI + '\n;CHARACTER_NAMES;', {}, {timeout:1000});
  if (!Array.isArray(people) || people.length !== 24 || names.length !== people.length) throw new Error('Unknown character catalogue');
  const answers = vm.runInNewContext(code + '\n;game.chars.map((_,i)=>Array.from({length:14},(_,q)=>game.qAttr(i,q)));', {}, {timeout:1000});
  spec.ui_code = `const SOURCE_CHARACTER_ANSWERS=${JSON.stringify(answers)};\n` + spec.ui_code;
  spec.assets = {};
  spec.piece_types = {};
  people.forEach((person,index) => {
    const hair = {black:'#20242c',brown:'#805331',blonde:'#edce70',red:'#c75e35',gray:'#a0a5ad'}[person.hair];
    const eye = {brown:'#805331',blue:'#3a8dcc',green:'#3e9851'}[person.eye];
    if (!hair || !eye || !/^[A-Za-z]{1,12}$/.test(names[index])) throw new Error('Unknown public portrait feature');
    const bottom = person.len === 'long' ? 66 : person.len === 'medium' ? 49 : 27;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 82 78">`+
      `<rect width="82" height="78" rx="8" fill="#e8edf4"/>`+
      `<path d="M18 31Q17 9 41 9Q65 9 64 31V${bottom}H18Z" fill="${hair}"/>`+
      (person.ear ? '<circle cx="21" cy="36" r="5" fill="#efbb95"/><circle cx="61" cy="36" r="5" fill="#efbb95"/>' : '')+
      '<ellipse cx="41" cy="35" rx="18" ry="23" fill="#efbb95"/>'+
      `<path d="M23 27Q21 10 41 10Q61 10 59 27Q45 26 39 18Q32 26 23 27Z" fill="${hair}"/>`+
      `<circle cx="33" cy="34" r="4" fill="${eye}"/><circle cx="49" cy="34" r="4" fill="${eye}"/>`+
      '<circle cx="33" cy="34" r="1.5" fill="#182232"/><circle cx="49" cy="34" r="1.5" fill="#182232"/>'+
      '<path d="M36 46Q41 50 46 46" fill="none" stroke="#8c4a39" stroke-width="2"/>'+
      (person.gl ? '<path d="M24 28h17v12H24ZM43 28h15v12H43ZM41 32h2" fill="none" stroke="#172033" stroke-width="2"/>' : '')+
      (person.be ? `<path d="M25 42Q41 53 57 42Q54 61 41 63Q28 61 25 42Z" fill="${hair}"/>` : '')+
      (person.hat ? '<path d="M20 18h42v5H20ZM28 3h26v15H28Z" fill="#5275ad"/>' : '')+
      `<text x="41" y="75" text-anchor="middle" font-size="11" fill="#172033">${names[index]}</text></svg>`;
    const key = `person_${index}`;
    spec.assets[key] = {media_type:'image/svg+xml',alt:names[index],width:82,height:78,uri:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')};
    spec.piece_types[key] = {shape:'image',asset:key,width:82,height:78,text_color:'#00000000'};
  });
}

function packageFor(entry) {
  const source = JSON.parse(fs.readFileSync(path.join(OUT,`${entry.kind}.json`),'utf8'));
  if (typeof source.server_code !== 'string' || !source.unit_tests) throw new Error(`Missing checked-in rules for ${entry.kind}`);
  const schemas = Object.fromEntries(['state','move','view'].map(name => [name,structuredClone(source.unit_tests[`${name}_schema`])]));
  const code = repairLegacySettlement(entry.kind,source.server_code);
  const spec = makeSpec(entry);
  if (entry.kind === 'guess_who') addCharacterPortraits(spec,code);
  const examples = sampleCases(entry,code);
  const title = `${entry.source} (Declarative)`;
  const tutorials = `<meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>${title}</h1><p>${entry.rules}</p><p>${entry.ui}</p></main>`;
  const translations = {};
  for (let i=0;i<languages.length;i++) {
    const locale = languages[i], translatedTitle = `${TITLE_TRANSLATIONS[entry.kind][i]} (${COPY.strings.Declarative[i]})`;
    const metadata = COPY.games[entry.kind];
    if (!metadata?.rules?.[i] || !metadata?.ui?.[i]) throw new Error(`Missing ${locale} metadata for ${entry.kind}`);
    const strings = Object.fromEntries(Object.entries(COPY.strings).map(([key,values])=>{
      if (values.length !== languages.length || !values[i]) throw new Error(`Missing ${locale} text: ${key}`);
      return [STRING_KEYS[key],values[i]];
    }));
    for (const [key,source] of Object.entries(sourceStrings(entry))) if (key !== 'title') {
      if (!COPY.errors[source]?.[i]) throw new Error(`Missing ${locale} server text: ${source}`);
      strings[key] = COPY.errors[source][i];
    }
    translations[locale] = {display_name:translatedTitle,short_description:metadata.rules[i],
      game_logic_rules:metadata.rules[i],game_ui_rules:metadata.ui[i],
      tutorial_strings:{[entry.rules]:metadata.rules[i],[entry.ui]:metadata.ui[i],[title]:translatedTitle},client_strings:{...strings,title:translatedTitle}};
  }
  const payload = {name:title,description:entry.rules,allowed_player_counts:entry.players,
    allows_leave_mid_match:source.allows_leave_mid_match,allows_join_mid_match:source.allows_join_mid_match,
    server_code:code,rules:entry.rules,ui_instructions:entry.ui,
    tutorial:{text:entry.rules,html:tutorials},images:allImages(entry.kind),
    unit_tests:{state_schema:schemas.state,move_schema:schemas.move,view_schema:schemas.view,cases:examples},
    translations,game_addition_request_id_and_secret:`example-only-html-to-declarative-${entry.kind}-replace-before-publishing`,
    declarative_ui:spec};
  const filename = path.join(OUT,`${entry.kind}.json`);
  fs.writeFileSync(filename,JSON.stringify(payload,null,2)+'\n');
  console.log(`${entry.kind}: ${Buffer.byteLength(JSON.stringify(payload))} bytes`);
}

for (const entry of entries) packageFor(entry);
