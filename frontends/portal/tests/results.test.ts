import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchOutcome} from '../src/core/results';
import type {Match} from '../src/core/types';

const match=(extra:Partial<Match>={}):Match=>({id:'own-match',game_id:'game',game_version:1,owner_user_id:'alice',status:'over',end_reason:'finished',players:[{id:'a',user_id:'alice',kind:'human',player_index:0,name:'Alice'},{id:'b',user_id:'bob',kind:'human',player_index:1,name:'Bob'}],turn_of_player_indices:null,move_count:5,created_at:'2026-11-18',...extra});

test('raw summaries and public detail views report seat zero wins, losses and named spectator results',()=>{
  for(const field of ['result','state']){
    const record=match({[field]:{winner:0,done:true}});
    assert.deepEqual(matchOutcome(record,'alice'),{kind:'win',winner:0});
    assert.deepEqual(matchOutcome(record,'bob'),{kind:'loss',winner:0});
    assert.deepEqual(matchOutcome(record,'spectator'),{kind:'winner',winner:0});
  }
  assert.deepEqual(matchOutcome(match({result:{winner:0},state:{hidden:true}}),'alice'),{kind:'win',winner:0});
});

test('draws require a truthful numeric sentinel or null with a terminal/draw flag',()=>{
  for(const state of [{winner:-1},{winner:null,draw:true},{winner:null,done:true}])assert.deepEqual(matchOutcome(match({state})),{kind:'draw'});
  for(const winner of ['alice','0',false,true,2,-2,NaN])assert.deepEqual(matchOutcome(match({state:{winner}}),'alice'),{kind:'unknown'});
  assert.deepEqual(matchOutcome(match({state:{winner:null,done:false},token_payouts:{0:10}}),'alice'),{kind:'unknown'});
  assert.deepEqual(matchOutcome(match({state:{done:true}}),'alice'),{kind:'unknown'});
});

test('early endings and ongoing records cannot acquire a normal result from retained state',()=>{
  assert.equal(matchOutcome(match({status:'ongoing',state:{winner:0}}),'alice'),null);
  for(const end_reason of ['timed_out','all_players_left'])assert.deepEqual(matchOutcome(match({end_reason,state:{winner:0,done:true}}),'alice'),{kind:'early'});
  assert.deepEqual(matchOutcome(match({end_reason:'timed_out',state:{done:false,winner:null}}),'alice'),{kind:'early'});
  assert.deepEqual(matchOutcome(match({players:[{id:'a',player_index:0,kind:'human',user_id:'alice'}],state:{solved:true}}),'alice'),{kind:'finished'});
});
