const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

// Runs the helper a game includes (game_i18n_helper.js) in a fake page that has the strings block.
function page(table){
  const document={
    documentElement:{lang:'',dir:''},
    getElementById:id=>id==='i18n-strings'?{textContent:JSON.stringify(table)}:null,
  };
  const context=vm.createContext({document,JSON});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../game_i18n_helper.js'),'utf8'),context);
  return {document,run:code=>vm.runInContext(code,context),t:(key,params)=>vm.runInContext(`t(${JSON.stringify(key)},${JSON.stringify(params)})`,context),
    apply:message=>vm.runInContext(`applyLocale(${JSON.stringify(message)})`,context)};
}

const TABLE={your_turn:'Your turn',wins:'{name} wins!',moves:'Moves: {count}'};

test('without a translation the game shows its own texts, with the placeholders filled in',()=>{
  const game=page(TABLE);
  assert.equal(game.t('your_turn'),'Your turn');
  assert.equal(game.t('wins',{name:'Ana'}),'Ana wins!');
  assert.equal(game.t('moves',{count:3}),'Moves: 3');
  assert.equal(game.t('wins',{}),'{name} wins!'); // a missing value stays visible, not "undefined"
  assert.equal(game.t('unknown_key'),'unknown_key');
});

test('the platform\'s translation replaces the texts, and what it lacks falls back to English',()=>{
  const game=page(TABLE);
  game.apply({locale:'es',direction:'ltr',strings:{wins:'¡{name} gana!'}});
  assert.equal(game.t('wins',{name:'Ana'}),'¡Ana gana!');
  assert.equal(game.t('your_turn'),'Your turn');
  assert.equal(game.document.documentElement.lang,'es');
});

test('a right-to-left language flips the page',()=>{
  const game=page(TABLE);
  game.apply({locale:'ar',direction:'rtl',strings:{your_turn:'دورك'}});
  assert.equal(game.document.documentElement.dir,'rtl');
  assert.equal(game.t('your_turn'),'دورك');
});

test('a message without translations changes nothing',()=>{
  const game=page(TABLE);
  game.apply({type:'state_changed'});
  assert.equal(game.t('wins',{name:'Bo'}),'Bo wins!');
  assert.equal(game.document.documentElement.lang,'');
});

test('going back to English restores the original texts',()=>{
  const game=page(TABLE);
  game.apply({locale:'es',strings:{your_turn:'Tu turno'}});
  game.apply({locale:'en'});
  assert.equal(game.t('your_turn'),'Your turn');
});

test('a message without translations (the viewer went back to English) shows the original texts again',()=>{
  const game=page(TABLE);
  game.apply({locale:'es',direction:'ltr',strings:{wins:'¡{name} gana!'}});
  assert.equal(game.t('wins',{name:'Ana'}),'¡Ana gana!');
  game.apply({locale:'en',direction:'ltr'});
  assert.equal(game.t('wins',{name:'Ana'}),'Ana wins!');
});

// tx(text): texts the game's SERVER wrote, matched to the `server_` templates of the table.
const SERVER_TABLE={
  your_turn:'Your turn',
  server_not_your_turn:'not your turn',
  server_need:'need {count} more cards',
  server_need_of:'need {count} more cards of {rank}',
  server_calls:'{who} calls {amount}.',
  server_calls_all_in:'{who} calls {amount} (all in).',
  server_special:'wait... (really?) [1+1] $5 ^up | down \ end',
  server_twice:'{a} and {a}',
};
test('tx shows the translation of the template with the values put back as written',()=>{
  const game=page(SERVER_TABLE);
  const tx=text=>game.run(`tx(${JSON.stringify(text)})`);
  game.apply({locale:'es',strings:{server_not_your_turn:'no es tu turno',server_need:'faltan {count} cartas',server_calls:'{who} iguala {amount}.'}});
  assert.equal(tx('not your turn'),'no es tu turno');
  assert.equal(tx('need 3 more cards'),'faltan 3 cartas');
  assert.equal(tx('Ana {x} calls 40.'),'Ana {x} iguala 40.'); // values stay as written, even if they look like placeholders
});

test('tx returns the text unchanged when no template matches or the page is in English',()=>{
  const game=page(SERVER_TABLE);
  const tx=text=>game.run(`tx(${JSON.stringify(text)})`);
  assert.equal(tx('something nobody listed'),'something nobody listed');
  assert.equal(tx('need cards'),'need cards');
  assert.equal(tx(''),'');
  assert.equal(tx('need 3 more cards'),'need 3 more cards');
  game.apply({locale:'es',strings:{server_need:'faltan {count} cartas'}});
  assert.equal(tx('something nobody listed'),'something nobody listed');
  assert.equal(tx('your turn'),'your turn'); // a page text, not a server template
  assert.equal(game.run('tx(undefined)'),undefined);
  assert.equal(game.run('tx(7)'),7);
});

test('tx prefers the most specific template and treats special characters as plain text',()=>{
  const game=page(SERVER_TABLE);
  const tx=text=>game.run(`tx(${JSON.stringify(text)})`);
  game.apply({locale:'es',strings:{server_need:'N {count}',server_need_of:'NO {count} {rank}',server_calls:'C {who} {amount}',server_calls_all_in:'CA {who} {amount}',server_special:'especial'}});
  assert.equal(tx('need 2 more cards of kings'),'NO 2 kings');
  assert.equal(tx('Bo calls 5 (all in).'),'CA Bo 5');
  assert.equal(tx('Bo calls 5.'),'C Bo 5');
  assert.equal(tx('wait... (really?) [1+1] $5 ^up | down \ end'),'especial');
  assert.equal(tx('wait!!! (really?) [1+1] $5 ^up | down \ end'),'wait!!! (really?) [1+1] $5 ^up | down \ end');
});

test('tx finds nothing on a page without server templates',()=>{
  const game=page({your_turn:'Your turn'});
  assert.equal(game.run('tx("not your turn")'),'not your turn');
});

test('tx and the platform agree: the same template order and the same captured values',()=>{
  // The cases of tests/test_server_texts.py, through the helper.
  const game=page(SERVER_TABLE);
  game.apply({locale:'es',strings:{server_twice:'{a} y {a}'}});
  assert.equal(game.run('tx("x and y")'),'x y x'); // the first value of a repeated name is used, as in game_messages.py
});
