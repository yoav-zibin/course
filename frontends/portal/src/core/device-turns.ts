import type {AccountData, LocalMatch} from './types';
import {localRevision} from './single-player';
import {equal} from './account-data';

export interface TurnStorage {
  getItem(key:string):Promise<string|null>;
  setItem(key:string,value:string):Promise<void>;
  removeItem(key:string):Promise<void>;
}

// Only the changed game state and newly added history frames go in the journal.
// Cloud acknowledgements, credentials and downloaded game packages stay outside it.
export interface DeviceTurn {
  id:string; matchId:string; gameId:string; version:number; from:number; revision:number; baseState:unknown;
  changes:Pick<LocalMatch,'logicState'|'state'|'status'|'end_reason'|'turn_of_player_indices'|'last_move_player_index'|'awaitingHandoff'|'move_count'>;
  moves:LocalMatch['moves'];
}

export function deviceTurn(id:string, before:LocalMatch, after:LocalMatch):DeviceTurn {
  return {id,matchId:before.id,gameId:before.game_id,version:before.game_version,from:before.move_count,
    revision:localRevision(before),baseState:before.logicState,
    changes:{logicState:after.logicState,state:after.state,status:after.status,end_reason:after.end_reason,
      turn_of_player_indices:after.turn_of_player_indices,last_move_player_index:after.last_move_player_index,
      awaitingHandoff:after.awaitingHandoff,move_count:after.move_count},moves:after.moves.slice(before.moves?.length??0)};
}

function containsTurn(match:LocalMatch|undefined,turn:DeviceTurn){
  if(!match||match.game_id!==turn.gameId||match.game_version!==turn.version||match.move_count<turn.changes.move_count||!match.moves)return false;
  if(match.move_count===turn.changes.move_count&&!equal(match.logicState,turn.changes.logicState))return false;
  const offset=match.moves.length-(match.move_count-turn.from);
  return offset>=0&&turn.moves.every((frame,i)=>equal(frame,match.moves[offset+i]));
}

function applyTurns(data:AccountData,turns:DeviceTurn[]):boolean {
  let changed=false;
  for(const turn of turns){
    const match=data.local[turn.matchId];
    // A kill between replacing the account and trimming the journal replays
    // this record. Compare only its frames, even for a long match.
    if(containsTurn(match,turn))continue;
    if(match&&match.game_id===turn.gameId&&match.game_version===turn.version&&
      match.move_count===turn.from&&localRevision(match)===turn.revision&&equal(match.logicState,turn.baseState)){
      data.local[match.id]={...match,...turn.changes,moves:[...(match.moves??[]),...turn.moves],
        local_revision:turn.revision+1,cloud_pending:true};
      changed=true;continue;
    }
    if(!match&&[...data.archivedMatches,...data.archives].some(row=>row?.id===turn.matchId&&containsTurn(row.match,turn)))continue;
    // A different writer can retire or replace the branch. Keep the exact
    // unmatched turn for recovery without reviving or overwriting that board.
    if(!data.archives.some(entry=>entry?.kind==='device-turn-conflict'&&entry.turn?.id===turn.id)){
      data.archives.push({kind:'device-turn-conflict',id:turn.matchId,turn});
      if(match&& !data.conflicts[match.id])data.conflicts[match.id]={message:'A saved move belongs to an earlier board. It is available in Preserved previous app data.'};
      changed=true;
    }
  }
  return changed;
}

interface CheckpointCursor {next?: {turns:DeviceTurn[];cursor:CheckpointCursor}}

/** The native app is the sole writer of its own journal. Web tabs retain their
 * existing shared storage transaction. Journal acknowledgements and checkpoint
 * cleanup use one ordered writer, independent of the larger account file. */
export class DeviceTurns {
  // A background read can deliver an older account after a checkpoint clears
  // its journal. Keep the intervening turns reachable only by such live reads.
  private latest:CheckpointCursor={};
  private snapshots=new WeakMap<AccountData,CheckpointCursor>();
  get cursor(){return this.latest;}
  private loaded?:Promise<void>;
  private writes:Promise<void>=Promise.resolve();
  private saved:DeviceTurn[]=[];
  private pending:DeviceTurn[]=[];
  constructor(private storage:TurnStorage,private key:string){}
  load():Promise<void>{
    return this.loaded??=this.storage.getItem(this.key).then(raw=>{
      if(raw!==null){
        const entries:unknown=JSON.parse(raw);
        if(!Array.isArray(entries)||!entries.every(entry=>entry&&typeof entry.id==='string'&&
          typeof entry.matchId==='string'&&Array.isArray(entry.moves)&&entry.moves.length&&
          Number.isSafeInteger(entry.from)&&entry.changes?.move_count===entry.from+entry.moves.length))
          throw new Error('Saved device moves need recovery. The original journal was kept.');
        this.saved=entries;
      }
    }).catch(error=>{this.loaded=undefined;throw error;});
  }
  stage(turn:DeviceTurn){this.pending.push(turn);}
  isSaving(matchId:string){return this.pending.some(turn=>turn.matchId===matchId);}
  get hasPending(){return this.pending.length>0;}
  get hasSaved(){return this.saved.length>0;}
  private serialize(run:()=>Promise<void>){
    const next=this.writes.then(run);this.writes=next.catch(()=>{});return next;
  }
  persist():Promise<void>{
    if(!this.pending.length)return Promise.resolve();
    return this.serialize(async()=>{
      await this.load();
      const batch=this.pending.slice();if(!batch.length)return;
      const entries=[...this.saved,...batch];
      await this.storage.setItem(this.key,JSON.stringify(entries));
      this.saved=entries;this.pending.splice(0,batch.length);
    });
  }
  restore(data:AccountData,cursor=this.latest){
    while(cursor.next){applyTurns(data,cursor.next.turns);cursor=cursor.next.cursor;}
    applyTurns(data,this.saved);this.snapshots.set(data,this.latest);return data;
  }
  display(data:AccountData):AccountData {
    const cursor=this.snapshots.get(data)??this.latest;
    if(cursor===this.latest&&!this.saved.length&&!this.pending.length)return data;
    const copy={...data,local:{...data.local},conflicts:{...data.conflicts},archives:[...data.archives]};
    this.restore(copy,cursor);applyTurns(copy,this.pending);return copy;
  }
  async checkpoint(read:()=>Promise<AccountData>,write:(data:AccountData)=>Promise<void>){
    const batch=this.saved.slice();if(!batch.length)return 0;
    const data=await read();
    if(applyTurns(data,batch))await write(data);
    const ids=new Set(batch.map(turn=>turn.id));
    await this.serialize(async()=>{
      const keep=this.saved.filter(turn=>!ids.has(turn.id));
      if(keep.length)await this.storage.setItem(this.key,JSON.stringify(keep));
      else await this.storage.removeItem(this.key);
      this.saved=keep;
      const cursor={};this.latest.next={turns:batch,cursor};this.latest=cursor;
    });
    return batch.length;
  }
}
