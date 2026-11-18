import {copyText} from '../platform/i18n';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Image,Share,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {SvgUri} from 'react-native-svg';
import {GameRenderer} from '../game/GameRenderer';
import {Button,Card,Copy,Dialog,Empty,Field,Notice,Row,Title,colors} from './components';
import {text,useApp} from './context';
import {FeedbackDialog} from './FeedbackDialog';
import {reportClientIssue} from '../core/reporting';
import {MatchOutcome} from './MatchOutcome';
import {GameInstructions} from './GameInstructions';

export function MatchStage() {
  const {p,run,navigate,notify,openMatch}=useApp(),t=(key:string,fallback:string)=>text(p,key,fallback);
  const match=p.selectedMatch!, game=p.game;
  const [share,setShare]=useState(false),[invite,setInvite]=useState<any>(null),[confirm,setConfirm]=useState(''),[feedback,setFeedback]=useState<any>(null),[clock,setClock]=useState(''),[rendererError,setRendererError]=useState('');
  const [help,setHelp]=useState(false);
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
      index=await p.actions.replay(index)??index;
      while(active()){
        const until=Date.now()+15000;
        while(active()&&(painted.current!==index||motion.current)){if(Date.now()>until)throw new Error(copyText("The history frame could not finish rendering. Try stepping through it manually."));await delay(40);}
        if(!active())break;
        await delay(180);if(!active()||index>=end)break;
        index=await p.actions.replay(index+1)??index+1;
      }
    }finally{if(active())setPlaying(false);}
  }
  useEffect(()=>{setInvite(null);setShare(false);setHelp(false);setRendererError('');},[match.id]);
  useEffect(()=>{if(!match.turn_deadline){setClock('');return;}const offset=match.server_time?Date.parse(match.server_time)-Date.now():0;
    const update=()=>{const seconds=Math.max(0,Math.ceil((Date.parse(match.turn_deadline)-Date.now()-offset)/1000));setClock(`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);};update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
  },[match.turn_deadline,match.server_time]);
  const shareMatch=()=>run(async()=>{if(!invite){const data=await p.actions.createInvite();setInvite(data);}setShare(true);});
  const submit=async(move:any)=>{if(local)await p.actions.practiceMove(move);else await p.actions.submitMove(move);};
  const replay=p.replayIndex;
  return <>
    <Row><Button compact secondary onPress={()=>navigate(local?'local':'matches')}>← {t('ui.portal.nav_matches','Matches')}</Button><View style={{flex:1}}/><Copy small muted>{local?copyText("On this device"):match.private?copyText("Invite only"):copyText("Public match")}</Copy>{game&&(game.tutorial_text||game.game_logic_rules||game.game_ui_rules)&&<Button compact secondary onPress={()=>setHelp(true)}>{t('ui.game.rules','How to play')}</Button>}<Button compact secondary onPress={()=>run(()=>p.actions.refreshMatch())}>{t('ui.action.refresh','Refresh')}</Button></Row>
    <View style={{gap:8}}><Row><Title>{game?.name||copyText("Match")}</Title><View style={{flex:1}}/><Copy style={{color:over?colors.purple:yourTurn?colors.accent:colors.blue,fontWeight:'700'}}>{over?copyText("Finished"):waiting?copyText("Waiting for players"):yourTurn?copyText("Your turn"):copyText("Game in progress")}</Copy></Row><Copy small muted>{match.move_count} {copyText("moves ·")} {match.players.length} {copyText("players")}{local?copyText(" · Saved on this device"):''}{clock?copyText(" · {v0} remaining",{v0:clock}):''}</Copy></View>
    <MatchOutcome match={match}/>
    <Row>{match.players.map(player=>{const profile=player.user_id?p.profiles[player.user_id]:null;const label=player.name||profile?.display_name||(player.user_id===p.account?.id?p.account?.display_name:null)||(player.kind==='computer'?copyText("Computer {v0}",{v0:player.player_index+1}):copyText("Player {v0}",{v0:player.player_index+1}));return <Card key={player.player_index} style={{padding:12,flexGrow:1,flexBasis:150,borderColor:turns.includes(player.player_index)?colors.accent:colors.border}}>
      <Row>{profile?.picture_url&&<Image source={{uri:new URL(profile.picture_url,p.baseUrl).href}} style={{width:32,height:32,borderRadius:16}}/>}<Copy style={{fontWeight:'600'}}>{player.kind==='computer'?'◈ ':''}{label}</Copy>{player.active===false&&<Copy small muted>{copyText("Left")}</Copy>}</Row>
      {!local&&player.user_id&&player.user_id!==p.account?.id&&<Row><Button secondary compact label={copyText("Report {v0}",{v0:label})} onPress={()=>setFeedback({type:'user',id:player.user_id,name:label})}>{copyText("Report")}</Button>{owner&&waiting&&<Button danger compact onPress={()=>run(()=>p.actions.removePlayer(player.user_id!))}>{copyText("Remove")}</Button>}</Row>}
    </Card>;})}</Row>
    {conflict&&<Notice error>{conflict.message}</Notice>}
    {conflict&&<Button danger onPress={()=>setConfirm('resolve')}>{copyText("Use server version…")}</Button>}
    {pending>0&&<Notice>{copyText("Your move is saved and waiting for server confirmation. The board stays paused so another action cannot conflict with it.")}</Notice>}
    {!local&&<Card style={{padding:16}}><Row><Copy style={{fontWeight:'700'}}>{match.bet_per_player?copyText("{v0} tokens per person",{v0:match.bet_per_player}):copyText("Free match")}</Copy><View style={{flex:1}}/><Copy muted>{match.token_pot||0} {copyText("tokens in the pot")}</Copy></Row>{over&&match.token_payouts&&seat&&<Copy style={{color:colors.accent}}>{copyText("Your payout:")} {match.token_payouts[String(seat.player_index)]||0} {copyText("tokens")}</Copy>}
      <Row>{waiting&&!seat&&p.account&&<Button onPress={()=>run(()=>p.actions.matchAction('join'))}>{t('ui.match.join','Join match')}</Button>}
        {waiting&&owner&&<Button disabled={!game?.allowed_player_counts.includes(match.players.filter(player=>player.active!==false).length)} onPress={()=>run(()=>p.actions.matchAction('start'))}>{t('ui.match.start','Start game')}</Button>}
        {waiting&&owner&&!match.bet_per_player&&<Button secondary onPress={()=>run(()=>p.actions.addBots(match.players.filter(player=>player.kind==='computer').length+1))}>{copyText("Add a computer")}</Button>}
        {waiting&&owner&&match.players.some(player=>player.kind==='computer')&&<Button secondary onPress={()=>run(()=>p.actions.addBots(Math.max(0,match.players.filter(player=>player.kind==='computer').length-1)))}>{copyText("Remove a computer")}</Button>}
        {participant&&<Button secondary onPress={shareMatch}>{t('ui.match.share','Share match')}</Button>}
        {participant&&!over&&(waiting||game?.allows_leave_mid_match)&&<Button danger onPress={()=>setConfirm('leave')}>{t('ui.match.leave','Leave match')}</Button>}
        {owner&&(waiting||over)&&<Button danger onPress={()=>setConfirm('delete')}>{copyText("Delete match")}</Button>}
        {over&&participant&&<Button onPress={()=>run(async()=>{const next=await p.actions.matchAction('rematch');await openMatch(next.id);})}>{copyText("Play again")}</Button>}
        <Button secondary onPress={()=>setFeedback({type:'match',id:match.id,name:game?.name||'match'})}>{copyText("Feedback")}</Button>
      </Row>
    </Card>}
    {waiting?<Card><Title small>{owner?copyText("Your lobby is ready"):copyText("Waiting for the host")}</Title><Copy muted>{owner?copyText("Share the match with a friend. Start when the required number of players has joined."):copyText("Join an open seat, then the host can start the game.")}</Copy>{owner&&!game?.allowed_player_counts.includes(match.players.length)&&<Copy small muted>{copyText("This game needs")} {game?.allowed_player_counts.join(', ')} {copyText("players.")}</Copy>}</Card>
      :match.awaitingHandoff?<Card style={{alignItems:'center',padding:40}}><Title small>{copyText("Pass the device")}</Title><Copy muted>{copyText("The next player’s board stays hidden until they are ready.")}</Copy><Button onPress={()=>run(()=>p.actions.revealLocal())}>{copyText("I’m ready")}</Button></Card>
      :game?.declarative_ui&&message?<View testID="game-stage" style={{backgroundColor:colors.surface,width:'100%',minWidth:0}}><GameRenderer spec={game.declarative_ui} message={message} contextKey={`${p.account?.id||'visitor'}:${match.id}:${game.version}`} onMove={submit} onAnimationStateChange={onAnimationStateChange} onScene={onScene} onError={error=>{stopPlayback();setRendererError(error.message);reportClientIssue('game_error',error);}}/></View>
      :<Empty>{copyText("Loading the match’s saved game version…")}</Empty>}
    {rendererError&&<Notice error>{rendererError}</Notice>}
    {!waiting&&<Card style={{padding:16}}><Row><Copy small muted>{replay===null?copyText("Live board"):copyText("Replay · move {v0} of {v1}",{v0:replay,v1:match.move_count})}</Copy><View style={{flex:1}}/><Button compact secondary disabled={Boolean(match.awaitingHandoff)||!match.move_count} label={playing?copyText("Pause history"):copyText("Play history")} onPress={()=>{if(playing)stopPlayback();else void run(playHistory);}}>{playing?copyText("Pause"):copyText("Play history")}</Button><Button compact secondary disabled={Boolean(match.awaitingHandoff)||replay===0} onPress={()=>{stopPlayback();return run(()=>p.actions.replay(Math.max(0,(replay??match.move_count)-1)));}}>{copyText("← Previous")}</Button><Button compact secondary disabled={Boolean(match.awaitingHandoff)||replay===null||replay>=match.move_count} onPress={()=>{stopPlayback();return run(()=>p.actions.replay(Math.min(match.move_count,(replay??match.move_count)+1)));}}>{copyText("Next →")}</Button><Button compact secondary disabled={replay===null} onPress={()=>{stopPlayback();return run(()=>p.actions.replay(null));}}>{copyText("Live board")}</Button></Row></Card>}
    {local&&over&&<Row><Button onPress={()=>run(async()=>{const next=await p.actions.startPractice(match.game_id,{humans:match.players.filter(player=>player.kind==='human').length,computers:match.players.filter(player=>player.kind==='computer').length,names:match.players.map(player=>player.name||'Player')});await openMatch(next.id);})}>{copyText("Play again")}</Button><Button secondary onPress={()=>run(async()=>{await p.actions.deleteLocal(match.id);navigate('local');})}>{copyText("Hide finished game")}</Button></Row>}
    {game&&<Dialog visible={help} title={t('ui.game.rules','How to play')} onClose={()=>setHelp(false)}><GameInstructions game={game}/></Dialog>}
    <Dialog visible={share} title={copyText("Share match")} onClose={()=>setShare(false)}>
      {invite&&<><Field label={copyText("Invite link")} value={invite.url} editable={false}/><Row><Button onPress={()=>run(async()=>{await Clipboard.setStringAsync(invite.url);notify(copyText("Invite link copied."));})}>{copyText("Copy link")}</Button><Button secondary onPress={()=>run(()=>Share.share({message:invite.url,url:invite.url}))}>{copyText("Share…")}</Button></Row><View style={{alignItems:'center',padding:20,backgroundColor:'white',borderRadius:8}}><SvgUri uri={new URL(invite.qr_code_url,p.baseUrl).href} width={200} height={200} accessibilityLabel={copyText("Match invite QR code")}/></View><Copy small muted>{match.private?copyText("Anyone with this invite can join this private match."):copyText("Send the link or scan the QR code to join.")}</Copy></>}
    </Dialog>
    <Dialog visible={Boolean(confirm)} title={confirm==='resolve'?copyText("Use server version?"):confirm==='delete'?copyText("Delete this match?"):copyText("Leave this match?")} onClose={()=>setConfirm('')}>
      <Copy>{confirm==='resolve'?copyText("Your pending branch will be kept in an archive before loading the server board."):confirm==='delete'?copyText("This removes the match for everyone. This action cannot be undone."):copyText("Your seat will leave the match. The server calculates any token settlement.")}</Copy>
      {confirm==='leave'&&match.pending_leave_payout!==null&&match.pending_leave_payout!==undefined&&<Copy>{copyText("Your payout:")} {match.pending_leave_payout} {copyText("tokens")}</Copy>}
      <Button danger onPress={()=>run(async()=>{if(confirm==='resolve')await p.actions.resolveConflict(match.id);else if(confirm==='delete'){await p.actions.deleteMatch();navigate('matches');}else if(!waiting){if(match.pending_leave_player_id){await p.actions.matchAction('playerLeft');setConfirm('');return;}await p.actions.matchAction('maybeLeave');return;}else await p.actions.matchAction('leave');setConfirm('');})}>{confirm==='resolve'?copyText("Use server version"):confirm==='delete'?copyText("Delete match"):!waiting&&!match.pending_leave_player_id?copyText("Preview leaving"):copyText("Confirm leaving")}</Button>
    </Dialog>
    {feedback&&<FeedbackDialog visible onClose={()=>setFeedback(null)} target={feedback}/>}
  </>;
}
