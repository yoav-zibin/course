import {copyText} from '../platform/i18n';
import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import {Image,Platform,Text,View,useWindowDimensions} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {shareInvite} from '../platform/share';
import {matchInviteUrl} from '../core/links';
import {performInviteShare,type InviteShareChannel} from '../core/invite-sharing';
import {GameRenderer} from '../game/GameRenderer';
import {preparePresentationRuntime} from '../game/preparePresentationResponse';
import {BACKGAMMON_GAME_ID,backgammonMatchPresentation} from '../game/backgammonMatchPresentation';
import {CHESS_GAME_ID,chessMatchPresentation,fillsMatchLandscape} from '../game/matchBoardLayout';
import {Button,Card,Copy,Dialog,Empty,Notice,Row,Title,colors} from './components';
import {text,useApp} from './context';
import {reportClientIssue} from '../core/reporting';
import {MatchOutcome} from './MatchOutcome';
import {GameInstructions} from './GameInstructions';
import {isSinglePlayerMatch, matchKind} from './match-kind';
import {RemoveSavedMatch} from './RemoveSavedMatch';
import type {MatchHistoryController} from './matchHistory';
import {matchGameName} from './match-game';
import {MATCH_HISTORY_HEIGHT} from './bugPosition';

function TurnClock({deadline,serverTime}:{deadline?:string|null;serverTime?:string|null}) {
  const [clock,setClock]=useState('');
  useEffect(()=>{
    if(!deadline){setClock('');return;}
    const offset=serverTime?Date.parse(serverTime)-Date.now():0;
    const update=()=>{
      const seconds=Math.max(0,Math.ceil((Date.parse(deadline)-Date.now()-offset)/1000));
      setClock(`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);
    };
    update();
    const timer=setInterval(update,1000);
    return()=>clearInterval(timer);
  },[deadline,serverTime]);
  return deadline&&clock?<Text>{copyText(" · {v0} remaining",{v0:clock})}</Text>:null;
}

export function MatchStage({menuOpen=false,onCloseMenu,menuHeader,menuExtras,history,onMenuDismissed}:{menuOpen?:boolean;onCloseMenu:()=>void;menuHeader?:ReactNode;menuExtras?:ReactNode;history:MatchHistoryController;onMenuDismissed?:()=>void}) {
  const {p,run,navigate,notify,openMatch,showSelectedMatch}=useApp(),t=(key:string,fallback:string)=>text(p,key,fallback);
  const match=p.selectedMatch!, game=p.game;
  const gameTitle=game?.name||matchGameName(match,p,copyText('Tic-tac-toe'))||copyText('Match');
  const backgammon=game?.id===BACKGAMMON_GAME_ID;
  const {width,height}=useWindowDimensions();
  const fillBoard=fillsMatchLandscape(match.game_id,width,height);
  const boardPresentation=backgammon?backgammonMatchPresentation:
    match.game_id===CHESS_GAME_ID?chessMatchPresentation(fillBoard):undefined;
  const hasInstructions=Boolean(game&&(game.tutorial_text||game.game_logic_rules||game.game_ui_rules));
  const sharingScope=JSON.stringify([p.baseUrl,p.account?.id,match.id]),currentSharingScope=useRef(sharingScope);currentSharingScope.current=sharingScope;
  const [confirm,setConfirm]=useState(''),[rendererError,setRendererError]=useState('');
  const [help,setHelp]=useState(false);
  const [frameHeight,setFrameHeight]=useState<number>();
  const fittedBoard=match.status!=='waiting_for_players'&&!match.awaitingHandoff;
  useEffect(()=>{
    if(Platform.OS!=='ios'||game||!fittedBoard)return;
    // The match identifies a board while its versioned package is in flight.
    const idle=requestIdleCallback(()=>{void Promise.resolve().then(preparePresentationRuntime).catch(()=>{});});
    return ()=>cancelIdleCallback(idle);
  },[game,fittedBoard]);
  const singlePlayer=isSinglePlayerMatch(match);
  const owner=Boolean(p.account&&[p.account.id,p.account.canonical_user_id,p.profile?.id].includes(match.owner_user_id)),local=Boolean(match.localMode),seat=match.players.find(player=>player.active!==false&&(match.localMode==='computer'?player.kind==='human':player.user_id===p.account?.id)),participant=local||Boolean(seat),waiting=match.status==='waiting_for_players',over=match.status==='over';
  const canPlayAgain=over&&(singlePlayer?(owner||local):participant);
  const activePlayers=match.players.filter(player=>player.active!==false).length;
  const privateReady=activePlayers===1?t('ui.match.ready_one','Ready to start with 1 player.'):text(p,'ui.match.ready_many','Ready to start with {count} players.',{count:activePlayers});
  const availableSeat=!singlePlayer&&waiting&&Boolean(game&&match.players.filter(player=>player.active!==false).length<Math.max(...game.allowed_player_counts));
  const canLeave=over?Boolean(p.account&&match.players.some(player=>player.kind==='human'&&player.user_id===p.account?.id)):participant&&(waiting||Boolean(game?.allows_leave_mid_match));
  const turns=match.turn_of_player_indices||[],yourTurn=participant&&Boolean(seat&&turns.includes(seat.player_index));
  const conflict=p.conflicts[match.id],pending=match.pending||0;
  const message=p.actions.presentationMessage();
  useEffect(()=>{setHelp(false);setConfirm('');setRendererError('');},[match.id,p.account?.id,p.baseUrl]);
  useEffect(()=>{if(!menuOpen){setHelp(false);setConfirm('');}},[menuOpen]);
  const inviteUrl=!singlePlayer&&waiting&&match.invite_code?matchInviteUrl(match.invite_code,p.baseUrl):null;
  const recordShare=(channel:InviteShareChannel)=>p.account&&currentSharingScope.current===sharingScope?p.actions.recordInviteShare(match.id,channel):Promise.resolve();
  const shareMatch=()=>run(async()=>{if(inviteUrl&&await performInviteShare('share_link',()=>shareInvite(inviteUrl),recordShare)==='copied')notify(copyText('Invite link copied.'));});
  const copyCode=()=>run(async()=>{await performInviteShare('copy_code',async()=>{await Clipboard.setStringAsync(match.invite_code!);return 'copied';},recordShare);notify(copyText('Invite code copied.'));});
  const submit=async(move:any)=>{if(local)await p.actions.practiceMove(move,{waitForSave:false});else await p.actions.submitMove(move);};
  const playAgain=()=>run(async()=>{
    if(!singlePlayer){
      const next=await p.actions.matchAction('rematch');await openMatch(next.id);return;
    }
    const computers=match.players.filter(player=>player.kind==='computer').length;
    const next=await p.actions.startPractice(match.game_id,{humans:match.players.length-computers,computers,
      humanSeat:computers?Math.floor(Math.random()*(computers+1)):0,
      ...(computers?{}:{names:match.players.map(player=>player.name||copyText('Player'))})});
    showSelectedMatch(next.id);
  });
  const playAgainButton=canPlayAgain?<Button compact disabled={p.loading||(!singlePlayer&&(Boolean(match.cloud_pending)||!p.network))} onPress={playAgain}>{copyText('Play again')}</Button>:null;
  const details=<View testID="match-details" style={{gap:22}}>
    <View style={{gap:8}}><Row><Title>{gameTitle}</Title><View style={{flex:1}}/><Copy style={{color:over?colors.purple:yourTurn?colors.accent:colors.blue,fontWeight:'700'}}>{over?copyText("Finished"):waiting?singlePlayer?privateReady:copyText("Waiting for players"):yourTurn?copyText("Your turn"):copyText("Game in progress")}</Copy></Row><Copy small muted>{match.move_count} {copyText("moves ·")} {match.players.length} {copyText("players")}{' · '}{matchKind(match)==='computer'?copyText('Against computers'):matchKind(match)==='pass_and_play'?copyText('Pass and play'):copyText('Multiplayer')}<TurnClock deadline={match.turn_deadline} serverTime={match.server_time}/></Copy></View>
    {!singlePlayer&&match.cloud_pending&&<Notice>{copyText('Match saved locally. Connect to save it in the cloud and get an invite link.')}</Notice>}
    {singlePlayer&&<Copy small muted>{match.saving_on_device?copyText('Saving on this device…'):match.cloud_pending?copyText('Saved locally · waiting to sync'):copyText('Saved in the cloud')}</Copy>}
    <MatchOutcome match={match}/>
    {(singlePlayer||(!participant&&!canLeave))&&<Button secondary onPress={()=>navigate('matches')}>{t('ui.match.leave','Leave match')}</Button>}
    <Row>{match.players.map(player=>{const profile=player.user_id?p.profiles[player.user_id]:null;const label=player.name||profile?.display_name||(player.user_id===p.account?.id?p.account?.display_name:null)||(player.kind==='computer'?copyText("Computer {v0}",{v0:player.player_index+1}):copyText("Player {v0}",{v0:player.player_index+1}));return <Card key={player.player_index} style={{padding:12,flexGrow:1,flexBasis:150,borderColor:turns.includes(player.player_index)?colors.accent:colors.border}}>
      <Row>{profile?.picture_url&&<Image source={{uri:new URL(profile.picture_url,p.baseUrl).href}} style={{width:32,height:32,borderRadius:16}}/>}<Copy style={{fontWeight:'600'}}>{player.kind==='computer'?'◈ ':''}{label}</Copy>{player.active===false&&<Copy small muted>{copyText("Left")}</Copy>}</Row>
      {turns.includes(player.player_index)&&!waiting&&!over&&<Copy small style={{color:colors.accent,fontWeight:'700'}}>{copyText('Current turn')}</Copy>}
      {!singlePlayer&&player.user_id&&player.user_id!==p.account?.id&&<Row>{owner&&waiting&&<Button danger compact onPress={()=>run(()=>p.actions.removePlayer(player.user_id!))}>{copyText("Remove")}</Button>}</Row>}
    </Card>;})}</Row>
    {conflict&&<Notice error>{conflict.message}</Notice>}
    {conflict&&<Button danger onPress={()=>setConfirm('resolve')}>{copyText("Use server version…")}</Button>}
    {singlePlayer&&<RemoveSavedMatch match={match} onRemoved={()=>navigate('matches')}/>}
    {!singlePlayer&&pending>0&&<Notice>{copyText("Your move is saved and waiting for server confirmation. The board stays paused so another action cannot conflict with it.")}</Notice>}
    {!singlePlayer&&<Card style={{padding:16}}><Row><Copy style={{fontWeight:'700'}}>{match.bet_per_player?copyText("{v0} tokens per person",{v0:match.bet_per_player}):copyText("Free match")}</Copy><View style={{flex:1}}/><Copy muted>{match.token_pot||0} {copyText("tokens in the pot")}</Copy></Row>{over&&match.token_payouts&&seat&&<Copy style={{color:colors.accent}}>{copyText("Your payout:")} {match.token_payouts[String(seat.player_index)]||0} {copyText("tokens")}</Copy>}
      <Row>{availableSeat&&!seat&&p.account&&<Button disabled={Boolean(match.cloud_pending)||!p.network} onPress={()=>run(()=>p.actions.matchAction('join'))}>{t('ui.match.join','Join match')}</Button>}
        {waiting&&owner&&<Button disabled={Boolean(match.cloud_pending)||!p.network||match.players.filter(player=>player.active!==false).length<2||!game?.allowed_player_counts.includes(match.players.filter(player=>player.active!==false).length)} onPress={()=>run(()=>p.actions.matchAction('start'))}>{t('ui.match.start_match','Start match')}</Button>}
        {(participant||canLeave)&&<Button danger disabled={!canLeave||Boolean(match.cloud_pending)||!p.network} onPress={()=>setConfirm('leave')}>{t('ui.match.leave','Leave match')}</Button>}
        {playAgainButton}
      </Row>
    </Card>}
    {inviteUrl&&<Card><Title small>{copyText('Invite friends')}</Title><Copy selectable style={{fontSize:28,fontWeight:'700',letterSpacing:4,direction:'ltr'}}>{match.invite_code}</Copy><Copy selectable style={{direction:'ltr'}}>{inviteUrl}</Copy><Row><Button secondary onPress={copyCode}>{copyText('Copy code')}</Button><Button onPress={shareMatch}>{copyText('Share link')}</Button></Row><Copy small muted>{copyText('Friends who open this link join an available seat or watch the match.')}</Copy></Card>}
    {hasInstructions&&<Row><View style={{flex:1}}/><Button compact secondary onPress={()=>setHelp(true)}>{t('ui.game.rules','How to play')}</Button></Row>}
    </View>;
  return <View style={fittedBoard?{flex:1,minHeight:0,minWidth:0}:{gap:22,minWidth:0}}>
    {waiting&&details}
    {singlePlayer&&waiting?<Card><Copy muted>{copyText('Private to your account')}</Copy>{owner&&<Button disabled={p.loading||Boolean(match.cloud_pending)||!p.network||!game?.allowed_player_counts.includes(activePlayers)} onPress={()=>run(()=>p.actions.matchAction('start'))}>{t('ui.match.start_match','Start match')}</Button>}</Card>
      :!singlePlayer&&waiting?<Card><Title small>{owner?copyText("Your lobby is ready"):copyText("Waiting for the host")}</Title><Copy muted>{owner?copyText("Share the match with a friend. Start when the required number of players has joined."):copyText("Join an open seat, then the host can start the game.")}</Copy>{owner&&!game?.allowed_player_counts.includes(match.players.length)&&<Copy small muted>{copyText("This game needs")} {game?.allowed_player_counts.join(', ')} {copyText("players.")}</Copy>}</Card>
      :match.awaitingHandoff?<Card style={{alignItems:'center',padding:40}}><Title small>{copyText("Pass the device")}</Title><Copy muted>{copyText("The next player’s board stays hidden until they are ready.")}</Copy><Button onPress={()=>run(()=>p.actions.revealLocal())}>{copyText("I’m ready")}</Button></Card>
      :game?.declarative_ui&&message?<View testID="game-stage" style={[{backgroundColor:colors.surface,width:'100%',minWidth:0},fittedBoard&&{flex:1,minHeight:0}]} onLayout={event=>{if(fittedBoard)setFrameHeight(event.nativeEvent.layout.height);}}><GameRenderer spec={game.declarative_ui} message={message} showToolbar={false} showDestinationsAfterSelection={backgammon} omitPieceId={backgammon&&hasInstructions?'help':undefined} boardPresentation={boardPresentation} frameHeight={fittedBoard?frameHeight:undefined} fillFrame={fillBoard} presentationHistory={p.actions.presentationHistory()} contextKey={`${p.account?.id||'visitor'}:${match.id}:${game.version}`} onMove={submit} onAnimationStateChange={history.onAnimationStateChange} onScene={history.onScene} onError={error=>{history.stopPlayback();setRendererError(error.message);reportClientIssue('game_error',error);}}/></View>
      :<Empty>{copyText("Loading the match’s saved game version…")}</Empty>}
    {rendererError&&<Notice error>{rendererError}</Notice>}
    {history.error&&history.error!==p.error&&<Notice error>{history.error}</Notice>}
    {!!playAgainButton&&!menuOpen&&!confirm&&!help&&p.replayIndex===null&&<View testID="finished-match-actions"
      style={{alignItems:'center',padding:6,marginBottom:fillBoard?MATCH_HISTORY_HEIGHT:0}}>{playAgainButton}</View>}
    <Dialog instant visible={menuOpen||help||Boolean(confirm)} title={confirm?confirm==='resolve'?copyText("Use server version?"):copyText("Leave this match?"):help?t('ui.game.rules','How to play'):copyText('Match menu')} onClose={()=>{if(confirm)setConfirm('');else if(help)setHelp(false);else onCloseMenu();}} onDismiss={onMenuDismissed} wide bottomClearance={96}>
      {confirm?<>
      <Copy>{confirm==='resolve'?copyText("Your pending branch will be kept in an archive before loading the server board."):over?copyText("This removes the match from your list. Other players can still see it."):waiting&&owner?copyText("Leaving closes this lobby for everyone and refunds any tokens."):copyText("Your seat will leave the match. The server calculates any token settlement.")}</Copy>
      {confirm==='leave'&&!waiting&&!over&&match.pending_leave_payout!==null&&match.pending_leave_payout!==undefined&&<Copy>{copyText("Your payout:")} {match.pending_leave_payout} {copyText("tokens")}</Copy>}
      <Button danger onPress={()=>run(async()=>{if(confirm==='resolve')await p.actions.resolveConflict(match.id);else if(waiting||over){await p.actions.leaveMatch();navigate('matches');}else if(match.pending_leave_player_id)await p.actions.leaveMatch();else{await p.actions.matchAction('maybeLeave');return;}setConfirm('');})}>{confirm==='resolve'?copyText("Use server version"):!waiting&&!over&&!match.pending_leave_player_id?copyText("Preview leaving"):copyText("Confirm leaving")}</Button>
      </>:help&&game?<GameInstructions game={game} summaryFirst/>:<>{menuHeader}{menuExtras}{details}{singlePlayer&&over&&<Row>{playAgainButton}<Button secondary disabled={!p.network||Boolean(match.cloud_pending)} onPress={()=>run(async()=>{await p.actions.deleteLocal(match.id);navigate('matches');})}>{copyText('Delete finished match')}</Button></Row>}</>}
    </Dialog>
  </View>;
}
export {preparePresentationRuntime};
