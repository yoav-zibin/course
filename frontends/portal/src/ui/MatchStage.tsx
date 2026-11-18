import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Image,Share,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {SvgUri} from 'react-native-svg';
import {GameRenderer} from '../game/GameRenderer';
import {Button,Card,Copy,Dialog,Empty,Field,Notice,Row,Title,colors} from './components';
import {text,useApp} from './context';
import {FeedbackDialog} from './FeedbackDialog';
import {reportClientIssue} from '../core/reporting';

export function MatchStage() {
  const {p,run,navigate,notify}=useApp(),t=(key:string,fallback:string)=>text(p,key,fallback);
  const match=p.selectedMatch!, game=p.game;
  const [share,setShare]=useState(false),[invite,setInvite]=useState<any>(null),[confirm,setConfirm]=useState(''),[feedback,setFeedback]=useState<any>(null),[clock,setClock]=useState(''),[rendererError,setRendererError]=useState('');
  const owner=match.owner_user_id===p.account?.id,local=Boolean(match.localMode),seat=match.players.find(player=>player.user_id===p.account?.id&&player.active!==false),participant=local||Boolean(seat),waiting=match.status==='waiting_for_players',over=match.status==='over';
  const turns=match.turn_of_player_indices||[],yourTurn=participant&&Boolean(seat&&turns.includes(seat.player_index));
  const conflict=p.conflicts[match.id],pending=match.pending||0;
  const message=p.actions.presentationMessage();
  const [playing,setPlaying]=useState(false),motion=useRef(false),painted=useRef<number|null>(null),playback=useRef(0);
  const stopPlayback=useCallback(()=>{playback.current++;setPlaying(false);},[]);
  const onAnimationStateChange=useCallback((busy:boolean)=>{motion.current=busy;},[]);
  const onScene=useCallback((_scene:unknown,applied:any)=>{painted.current=applied.replay?.index??null;},[]);
  useEffect(()=>{stopPlayback();painted.current=null;motion.current=false;return()=>{playback.current++;};},[match.id,p.account?.id,p.locale]);
  async function playHistory(){
    const epoch=++playback.current,end=match.move_count;let index=p.replayIndex??0;
    if(index>=end)index=0;setPlaying(true);
    const active=()=>epoch===playback.current;
    const delay=(time:number)=>new Promise(resolve=>setTimeout(resolve,time));
    try{
      await p.actions.replay(index);
      while(active()){
        const until=Date.now()+15000;
        while(active()&&(painted.current!==index||motion.current)){if(Date.now()>until)throw new Error('The history frame could not finish rendering. Try stepping through it manually.');await delay(40);}
        if(!active())break;
        await delay(180);if(!active()||index>=end)break;
        await p.actions.replay(++index);
      }
    }finally{if(active())setPlaying(false);}
  }
  useEffect(()=>{setInvite(null);setShare(false);setRendererError('');},[match.id]);
  useEffect(()=>{if(!match.turn_deadline){setClock('');return;}const offset=match.server_time?Date.parse(match.server_time)-Date.now():0;
    const update=()=>{const seconds=Math.max(0,Math.ceil((Date.parse(match.turn_deadline)-Date.now()-offset)/1000));setClock(`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);};update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
  },[match.turn_deadline,match.server_time]);
  const shareMatch=()=>run(async()=>{if(!invite){const data=await p.actions.createInvite();setInvite(data);}setShare(true);});
  const submit=async(move:any)=>{if(local)await p.actions.practiceMove(move);else await p.actions.submitMove(move);};
  const replay=p.replayIndex;
  return <>
    <Row><Button compact secondary onPress={()=>navigate(local?'local':'matches')}>← {t('ui.portal.nav_matches','Matches')}</Button><View style={{flex:1}}/><Copy small muted>{local?'On this device':match.private?'Invite only':'Public match'}</Copy><Button compact secondary onPress={()=>run(()=>p.actions.refreshMatch())}>{t('ui.action.refresh','Refresh')}</Button></Row>
    <View style={{gap:8}}><Row><Title>{game?.name||'Match'}</Title><View style={{flex:1}}/><Copy style={{color:over?colors.purple:yourTurn?colors.accent:colors.blue,fontWeight:'700'}}>{over?'Finished':waiting?'Waiting for players':yourTurn?'Your turn':'Game in progress'}</Copy></Row><Copy small muted>{match.move_count} moves · {match.players.length} players{local?' · Saved on this device':''}{clock?` · ${clock} remaining`:''}</Copy></View>
    <Row>{match.players.map(player=>{const profile=player.user_id?p.profiles[player.user_id]:null;const label=player.name||profile?.display_name||(player.user_id===p.account?.id?p.account?.display_name:null)||(player.kind==='computer'?`Computer ${player.player_index+1}`:`Player ${player.player_index+1}`);return <Card key={player.player_index} style={{padding:12,flexGrow:1,minWidth:150,borderColor:turns.includes(player.player_index)?colors.accent:colors.border}}>
      <Row>{profile?.picture_url&&<Image source={{uri:new URL(profile.picture_url,p.baseUrl).href}} style={{width:32,height:32,borderRadius:16}}/>}<Copy style={{fontWeight:'600'}}>{player.kind==='computer'?'◈ ':''}{label}</Copy>{player.active===false&&<Copy small muted>Left</Copy>}</Row>
      {!local&&player.user_id&&player.user_id!==p.account?.id&&<Row><Button secondary compact label={`Report ${label}`} onPress={()=>setFeedback({type:'user',id:player.user_id,name:label})}>Report</Button>{owner&&waiting&&<Button danger compact onPress={()=>run(()=>p.actions.removePlayer(player.user_id!))}>Remove</Button>}</Row>}
    </Card>;})}</Row>
    {conflict&&<Notice error>{conflict.message}</Notice>}
    {conflict&&<Button danger onPress={()=>setConfirm('resolve')}>Use server version…</Button>}
    {pending>0&&<Notice>Your move is saved and waiting for server confirmation. The board stays paused so another action cannot conflict with it.</Notice>}
    {!local&&<Card style={{padding:16}}><Row><Copy style={{fontWeight:'700'}}>{match.bet_per_player?`${match.bet_per_player} tokens per person`:'Free match'}</Copy><View style={{flex:1}}/><Copy muted>{match.token_pot||0} tokens in the pot</Copy></Row>{over&&match.token_payouts&&seat&&<Copy style={{color:colors.accent}}>Your payout: {match.token_payouts[String(seat.player_index)]||0} tokens</Copy>}
      <Row>{waiting&&!seat&&p.account&&<Button onPress={()=>run(()=>p.actions.matchAction('join'))}>{t('ui.match.join','Join match')}</Button>}
        {waiting&&owner&&<Button disabled={!game?.allowed_player_counts.includes(match.players.filter(player=>player.active!==false).length)} onPress={()=>run(()=>p.actions.matchAction('start'))}>{t('ui.match.start','Start game')}</Button>}
        {waiting&&owner&&!match.bet_per_player&&<Button secondary onPress={()=>run(()=>p.actions.addBots(match.players.filter(player=>player.kind==='computer').length+1))}>Add a computer</Button>}
        {waiting&&owner&&match.players.some(player=>player.kind==='computer')&&<Button secondary onPress={()=>run(()=>p.actions.addBots(Math.max(0,match.players.filter(player=>player.kind==='computer').length-1)))}>Remove a computer</Button>}
        {participant&&<Button secondary onPress={shareMatch}>{t('ui.match.share','Share match')}</Button>}
        {participant&&!over&&(waiting||game?.allows_leave_mid_match)&&<Button danger onPress={()=>setConfirm('leave')}>{t('ui.match.leave','Leave match')}</Button>}
        {owner&&(waiting||over)&&<Button danger onPress={()=>setConfirm('delete')}>Delete match</Button>}
        {over&&participant&&<Button onPress={()=>run(()=>p.actions.matchAction('rematch'))}>Play again</Button>}
        <Button secondary onPress={()=>setFeedback({type:'match',id:match.id,name:game?.name||'match'})}>Feedback</Button>
      </Row>
    </Card>}
    {waiting?<Card><Title small>{owner?'Your lobby is ready':'Waiting for the host'}</Title><Copy muted>{owner?'Share the match with a friend. Start when the required number of players has joined.':'Join an open seat, then the host can start the game.'}</Copy>{owner&&!game?.allowed_player_counts.includes(match.players.length)&&<Copy small muted>This game needs {game?.allowed_player_counts.join(', ')} players.</Copy>}</Card>
      :match.awaitingHandoff&&replay===null?<Card style={{alignItems:'center',padding:40}}><Title small>Pass the device</Title><Copy muted>The next player’s board stays hidden until they are ready.</Copy><Button onPress={()=>run(()=>p.actions.revealLocal())}>I’m ready</Button></Card>
      :game?.declarative_ui&&message?<View testID="game-stage" style={{backgroundColor:colors.surface,borderRadius:12,overflow:'hidden',borderWidth:1,borderColor:colors.border}}><GameRenderer spec={game.declarative_ui} message={message} contextKey={`${p.account?.id||'visitor'}:${match.id}:${game.version}:${p.locale}`} onMove={submit} onAnimationStateChange={onAnimationStateChange} onScene={onScene} onError={error=>{stopPlayback();setRendererError(error.message);reportClientIssue('game_error',error);}}/></View>
      :<Empty>Loading the match’s saved game version…</Empty>}
    {rendererError&&<Notice error>{rendererError}</Notice>}
    {!waiting&&<Card style={{padding:16}}><Row><Copy small muted>{replay===null?'Live board':`Replay · move ${replay} of ${match.move_count}`}</Copy><View style={{flex:1}}/><Button compact secondary disabled={!match.move_count} label={playing?'Pause history':'Play history'} onPress={()=>{if(playing)stopPlayback();else void run(playHistory);}}>{playing?'Pause':'Play history'}</Button><Button compact secondary disabled={replay===0} onPress={()=>{stopPlayback();return run(()=>p.actions.replay(Math.max(0,(replay??match.move_count)-1)));}}>← Previous</Button><Button compact secondary disabled={replay===null||replay>=match.move_count} onPress={()=>{stopPlayback();return run(()=>p.actions.replay(Math.min(match.move_count,(replay??match.move_count)+1)));}}>Next →</Button><Button compact secondary disabled={replay===null} onPress={()=>{stopPlayback();return run(()=>p.actions.replay(null));}}>Live board</Button></Row></Card>}
    {local&&over&&<Row><Button onPress={()=>run(()=>p.actions.startPractice(match.game_id,{humans:match.players.filter(player=>player.kind==='human').length,computers:match.players.filter(player=>player.kind==='computer').length,names:match.players.map(player=>player.name||'Player')}))}>Play again</Button><Button secondary onPress={()=>run(async()=>{await p.actions.deleteLocal(match.id);navigate('local');})}>Hide finished game</Button></Row>}
    <Dialog visible={share} title="Share match" onClose={()=>setShare(false)}>
      {invite&&<><Field label="Invite link" value={invite.url} editable={false}/><Row><Button onPress={()=>run(async()=>{await Clipboard.setStringAsync(invite.url);notify('Invite link copied.');})}>Copy link</Button><Button secondary onPress={()=>run(()=>Share.share({message:invite.url,url:invite.url}))}>Share…</Button></Row><View style={{alignItems:'center',padding:20,backgroundColor:'white',borderRadius:8}}><SvgUri uri={new URL(invite.qr_code_url,p.baseUrl).href} width={200} height={200} accessibilityLabel="Match invite QR code"/></View><Copy small muted>{match.private?'Anyone with this invite can join this private match.':'Send the link or scan the QR code to join.'}</Copy></>}
    </Dialog>
    <Dialog visible={Boolean(confirm)} title={confirm==='resolve'?'Use server version?':confirm==='delete'?'Delete this match?':'Leave this match?'} onClose={()=>setConfirm('')}>
      <Copy>{confirm==='resolve'?'Your pending branch will be kept in an archive before loading the server board.':confirm==='delete'?'This removes the match for everyone. This action cannot be undone.':'Your seat will leave the match. The server calculates any token settlement.'}</Copy>
      {confirm==='leave'&&match.pending_leave_payout!==null&&match.pending_leave_payout!==undefined&&<Copy>Your payout: {match.pending_leave_payout} tokens</Copy>}
      <Button danger onPress={()=>run(async()=>{if(confirm==='resolve')await p.actions.resolveConflict(match.id);else if(confirm==='delete'){await p.actions.deleteMatch();navigate('matches');}else if(!waiting){if(match.pending_leave_player_id){await p.actions.matchAction('playerLeft');setConfirm('');return;}await p.actions.matchAction('maybeLeave');return;}else await p.actions.matchAction('leave');setConfirm('');})}>{confirm==='resolve'?'Use server version':confirm==='delete'?'Delete match':!waiting&&!match.pending_leave_player_id?'Preview leaving':'Confirm leaving'}</Button>
    </Dialog>
    {feedback&&<FeedbackDialog visible onClose={()=>setFeedback(null)} target={feedback}/>}
  </>;
}
