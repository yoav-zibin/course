// Dependency-free checks for the generated packages and their exact JS sources.
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const kinds = ['chinese_checkers', 'abalone', 'havannah'];
const fail = message => { throw new Error(message); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  : JSON.stringify(value);
const idFor = move => 'move_' + Object.keys(move).map(k => `${k}_${Array.isArray(move[k]) ? move[k].join('.') : move[k]}`).join('_');
function load(kind) {
  const file = new URL(`games/declarative/${kind}.json`, root);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function vmObject(source, expose) {
  const context = {InvalidMove: class InvalidMove extends Error {}};
  vm.createContext(context);
  vm.runInContext(`${source}\n${expose}`, context, {timeout: 3000});
  return context;
}
function reducerFor(pkg) {
  return vmObject(pkg.declarative_ui.ui_code, 'this.reducer=gameUI;');
}
function messageFor(test, view, seat, active) {
  const players = test.ctx.players.map((p, player_index) => ({player_index, player_id:p.id, kind:p.kind, name:p.display_name}));
  return {type:'state_changed', state:view, view, players, turn_of_player_indices:active?[seat]:null,
    my_player_index:seat, acting_for_player_index:active?seat:null, status:'ongoing',
    move_count:test.ctx.move_count, strings:{}};
}
function simulate(kind, game, playersCount, initialSeed) {
  let seed = initialSeed >>> 0;
  const ctx = {players:Array.from({length:playersCount},(_,i)=>({id:`sim-${i}`,kind:'human',display_name:`Sim ${i+1}`,active:true})),pot:0,
    random:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}};
  let result = game.newMatch(ctx);
  for (let step=0;result.turn && step<120;step++) {
    const playerID=result.turn[0], before=canonical(result.state), view=game.viewFor(result.state,playerID,ctx);
    if (!view.legal.length) fail(`${kind}: simulation stalled without a legal move at step ${step}`);
    const move=game.computerMove(result.state,playerID,ctx);
    if (!move || !view.legal.some(candidate=>canonical(candidate)===canonical(move))) fail(`${kind}: computer chose an illegal move`);
    result=game.applyMove(result.state,playerID,move,ctx);
    if (canonical(result.state)===before) fail(`${kind}: legal move did not change the state`);
    if (kind==='chinese_checkers') for(let seat=0;seat<playersCount;seat++) if(result.state.board.filter(owner=>owner===seat).length!==10) fail('Chinese Checkers lost a marble');
    if (kind==='abalone') for(let seat=0;seat<2;seat++) if(result.state.board.filter(owner=>owner===seat).length+result.state.ejected[seat]!==14) fail('Abalone marble accounting changed');
    if (kind==='havannah' && result.state.board.length!==61) fail('Havannah board geometry changed');
    if (kind==='catan') {
      if(result.state.roads.length!==72||result.state.settlements.length!==54) fail('Catan board state geometry changed');
      if(result.state.bank.some(count=>count<0)||result.state.resources.some(hand=>hand.some(count=>count<0))) fail('Catan resource bank became negative');
    }
  }
  return canonical(result);
}

for (const kind of kinds) {
  const pkg = load(kind);
  const source = vmObject(pkg.server_code, 'this.game=game;this.hexCells=HEX_CELLS;this.hexIndex=HEX_INDEX;this.camps=HEX_CAMP_IDS;this.geometry=CATAN_GEOMETRY;');
  const ui = reducerFor(pkg);
  const cells = pkg.declarative_ui.boards[0].cells;
  if (new Set(cells.map(cell => cell.id)).size !== cells.length) fail(`${kind}: duplicate board cells`);
  if (!pkg.unit_tests || pkg.unit_tests.cases.length !== 3) fail(`${kind}: missing example traces`);

  for (const test of pkg.unit_tests.cases) {
    const roster = test.ctx.players, seat = roster.findIndex(player => player.id === test.player_id);
    const message = messageFor(test, test.view_of_mover, seat, true);
    let response = ui.reducer.reduce(message, null), local = response.local_state;
    const sources = test.move.from === undefined ? [] : Array.isArray(test.move.from) ? test.move.from : [test.move.from];
    for (const sourceCell of sources) {
      response = ui.reducer.reduce({type:'ui_event', event:{type:'tap', id:`piece_${sourceCell}`}, state_changed:message}, local);
      local = response.local_state;
    }
    if(response.scene.targets.some(target=>!target.hit_area||!Number.isFinite(target.hit_area.width)||!Number.isFinite(target.hit_area.height)||target.hit_area.width<=0||target.hit_area.height<=0)) fail(`${kind}: a legal target has no usable hit area`);
    response = ui.reducer.reduce({type:'ui_event', event:{type:'tap', id:idFor(test.move)}, state_changed:message}, local);
    if (canonical(response.make_move) !== canonical(test.move)) fail(`${kind}: UI did not emit ${canonical(test.move)}`);

    const spectator = ui.reducer.reduce(messageFor(test, test.view_of_other, (seat + 1) % roster.length, false), null);
    if (spectator.scene.targets.length || spectator.scene.controls.length) fail(`${kind}: spectator received active controls`);
  }

  if (kind === 'chinese_checkers') {
    if (source.hexCells.length !== 121 || source.camps.length !== 6 || source.camps.some(camp => camp.length !== 10)) fail('Chinese Checkers geometry is incomplete');
    if (!pkg.allowed_player_counts.includes(5)) fail('Chinese Checkers is missing the five-player setup');
    const state = source.game.newMatch({players:pkg.unit_tests.cases[0].ctx.players, pot:0, random:()=>0.5}).state;
    state.board.fill(-1);
    const [from, over1, land1, over2, land2] = [[0,0],[1,0],[2,0],[3,0],[4,0]].map(([q,r])=>source.hexIndex[`${q},${r}`]);
    state.board[from]=0; state.board[over1]=1; state.board[over2]=1;
    const legal = source.game.viewFor(state, 'p0', {players:pkg.unit_tests.cases[0].ctx.players}).legal;
    if (!legal.some(move => move.from===from && move.to===land2)) fail('Chinese Checkers chained hop was not offered');
    const fivePlayers = Array.from({length:5},(_,i)=>({id:`five-${i}`,kind:'human',display_name:`P${i+1}`}));
    const fiveState=source.game.newMatch({players:fivePlayers,pot:0,random:()=>0.5}).state;
    if(fiveState.players.length!==5||fiveState.board.filter(owner=>owner>=0).length!==50) fail('Chinese Checkers five-player setup is incomplete');
  }
  if (kind === 'abalone') {
    const state = source.game.newMatch({players:pkg.unit_tests.cases[0].ctx.players, pot:0, random:()=>0.5}).state;
    state.board.fill(-1);
    const [a,b,c] = [[2,0],[3,0],[4,0]].map(([q,r])=>source.hexIndex[`${q},${r}`]);
    state.board[a]=state.board[b]=0; state.board[c]=1;
    const move = {from:[a,b],to:[b,c],dir:0};
    if (!source.game.viewFor(state,'p0',{players:pkg.unit_tests.cases[0].ctx.players}).legal.some(candidate=>canonical(candidate)===canonical(move))) fail('Abalone edge push was not offered');
    const result = source.game.applyMove(state,'p0',move,{players:pkg.unit_tests.cases[0].ctx.players,pot:0,random:()=>0.5});
    if (result.state.ejected[0]!==1 || result.state.board[c]!==0) fail('Abalone failed to eject the pushed marble');
  }
  if (kind === 'havannah') {
    const state = source.game.newMatch({players:pkg.unit_tests.cases[0].ctx.players, pot:0, random:()=>0.5}).state;
    state.board.fill(-1);
    const ring = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(([q,r])=>source.hexIndex[`${q},${r}`]);
    for (const cell of ring.slice(0,5)) state.board[cell]=0;
    const result = source.game.applyMove(state,'p0',{cell:ring[5]},{players:pkg.unit_tests.cases[0].ctx.players,pot:0,random:()=>0.5});
    if (result.turn!==null || result.state.winner!==0) fail('Havannah failed to detect an enclosed ring');
  }

  const simulationPlayers=kind==='chinese_checkers'?5:kind==='catan'?3:2;
  const firstRun=simulate(kind,source.game,simulationPlayers,0x5eed1234);
  const repeatRun=simulate(kind,source.game,simulationPlayers,0x5eed1234);
  if(firstRun!==repeatRun) fail(`${kind}: same seed produced different match results`);
  console.log(`${kind}: ${cells.length} spaces; rule and presentation examples passed`);
}
console.log('Hex-family geometry and special-rule checks passed.');
