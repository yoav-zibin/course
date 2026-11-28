import {visibleErrorMessage} from '../core/account-scope';
import {copyText,playerText} from '../platform/i18n';
import React, {useEffect, useRef, useState} from 'react';
import {FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {categoryKey, CAROUSEL_PAGE_SIZE} from '../core';
import type {Game, GameCarousel, Match} from '../core/types';
import {Button, Card, Choices, Copy, Dialog, Empty, Field, Notice, Row, Title, colors} from './components';
import {text, useApp} from './context';
import {MatchOutcome} from './MatchOutcome';
import {GameInstructions} from './GameInstructions';
import {matchGameName} from './match-game';
import {GameSearch} from './GameSearch';
import {isSinglePlayerMatch, matchKind, singlePlayerMatches} from './match-kind';
import {readLocalUiTest} from '../platform/legacy';
import {RemoveSavedMatch} from './RemoveSavedMatch';

function useText() {const {p} = useApp(); return (key: string, fallback: string) => text(p,key,fallback);}
function GameCard({game}: {game: Game}) {
  const {p,openGame,run} = useApp();
  return <Card style={s.gameCard}><Pressable android_ripple={{color:'#465572'}} accessibilityRole="link" accessibilityLabel={copyText("Play {v0}",{v0:game.name})} onPress={()=>run(()=>openGame(game.id))} style={({pressed})=>({gap:12,opacity:pressed?.75:1})}>
    {game.cover_url ? <Image source={{uri:new URL(game.cover_url,p.baseUrl).href}} style={s.cover} resizeMode="contain" accessibilityLabel={playerText(game.name)}/> : <View style={[s.cover,{alignItems:'center',justifyContent:'center'}]}><Copy style={{fontSize:44,color:colors.blue}}>◇</Copy></View>}
    <Title small>{game.name}</Title><Copy small muted numberOfLines={3}>{game.description}</Copy>
    <Copy small style={{color:colors.blue}}>{game.allowed_player_counts?.join(', ')} {copyText("players")}</Copy>
  </Pressable><Row><Button compact onPress={()=>run(()=>openGame(game.id))}>{copyText("Play")}</Button></Row></Card>;
}

const GAME_CARD_WIDTH = 265;
const GAME_CARD_GAP = 14;
const gameCardLayout = (_: ArrayLike<Game> | null | undefined, index: number) =>
  ({length: GAME_CARD_WIDTH, offset: index * (GAME_CARD_WIDTH + GAME_CARD_GAP), index});

function GameCarouselRow({kind, title}: {kind: GameCarousel; title: string}) {
  const {p}=useApp();
  const games = kind === 'recentGames' || kind === 'popularGames' ? p[kind] : p.categoryGames[kind] ?? [];
  const loadMore = () => {void p.actions.loadMoreGames(kind).catch(()=>{});};
  const prefetch = useRef({loadMore, index: 0});
  prefetch.current = {loadMore, index: games.length >= CAROUSEL_PAGE_SIZE ? games.length - CAROUSEL_PAGE_SIZE / 2 - 1 : Infinity};
  const onViewableItemsChanged = useRef(({viewableItems}: {viewableItems: {index?: number | null}[]}) => {
    const {index, loadMore} = prefetch.current;
    if (viewableItems.some(item => typeof item.index === 'number' && item.index >= index)) loadMore();
  }).current;
  const viewabilityConfig = useRef({itemVisiblePercentThreshold: 50}).current;
  if (!games.length) return null;
  return <>
    <Title small>{title}</Title>
    <FlatList testID={kind} horizontal keyboardShouldPersistTaps="handled"
      data={games} keyExtractor={game=>game.id}
      renderItem={({item})=><GameCard game={item}/>}
      ItemSeparatorComponent={GameCardSeparator} getItemLayout={gameCardLayout}
      viewabilityConfig={viewabilityConfig} onViewableItemsChanged={onViewableItemsChanged}
      onEndReachedThreshold={0.35} onEndReached={loadMore}/>
  </>;
}

function GameCardSeparator() {return <View style={{width:GAME_CARD_GAP}}/>;}

export function Catalog() {
  const {p,run,openAccount} = useApp(), t=useText();
  const [proposal,setProposal]=useState(false);
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[rules,setRules]=useState('');
  return <>
    <View style={{gap:10}}><Copy small style={s.eyebrow}>{copyText("YOUR NEXT GOOD GAME")}</Copy><Title>{t('ui.games.title','Let’s play.')}</Title><Copy muted>{copyText('Play against computers, pass the device, or invite friends. All matches save to your account across web, iPhone, and Android.')}</Copy></View>
    {!p.account && <Card><Title small>{t('ui.auth.welcome','Make yourself at home')}</Title><Copy muted>{t('ui.portal.login_note','Log in or continue as a guest to create and join matches.')}</Copy><Row><Button onPress={openAccount}>{t('ui.auth.log_in','Log in / continue as guest')}</Button><Copy small muted>{copyText('Your account keeps every match saved in the cloud.')}</Copy></Row></Card>}
    <GameSearch/>
    <GameCarouselRow kind="recentGames" title={t('ui.games.recent','Recently played')}/>
    {p.gameCategories.length ? p.gameCategories.map(row =>
      <GameCarouselRow key={row.id} kind={categoryKey(row.id)} title={t(`ui.games.category.${row.id}`,row.title)}/>)
      : <GameCarouselRow kind="popularGames" title={t('ui.games.popular','Popular games')}/>}
    <Card><Title small>{t('ui.proposal.title','Missing a game? Propose it')}</Title><Copy muted>{t('ui.proposal.explainer','Tell us which game you would like to play here. Our AI agents will review your proposal and create the game within 24 hours.')}</Copy><Row><Button secondary onPress={()=>setProposal(true)}>{t('ui.proposal.submit','Propose a game')}</Button></Row></Card>
    <Dialog visible={proposal} title={t('ui.proposal.title','Propose a game')} onClose={()=>setProposal(false)}>
      <Field label={t('ui.proposal.name_label','Game name')} value={name} onChangeText={setName} maxLength={120}/><Field label={t('ui.proposal.description_label','Why this game?')} multiline value={description} onChangeText={setDescription} maxLength={2000}/><Field label={t('ui.proposal.rules_label','Link to the rules (optional)')} value={rules} onChangeText={setRules} autoCapitalize="none" keyboardType="url"/>
      <Button disabled={!name.trim()} onPress={()=>run(async()=>{await p.actions.request('POST','/game-proposals',{game_name:name.trim(),description:description.trim(),rules_url:rules.trim(),proposer_name:p.account?.display_name||''});setProposal(false);setName('');})}>{t('ui.proposal.submit','Submit proposal')}</Button>
    </Dialog>
  </>;
}

export function GameDetail() {
  const {p,run,openAccount,showSelectedMatch} = useApp(),t=useText();
  // Catalog cards already include the available player counts. A player can
  // choose a mode while the same full, version-checked package is downloading.
  const summary=!p.selectedGame && [p.games,p.popularGames,p.savedGames,p.recentGames,...Object.values(p.categoryGames)]
    .map(games=>games.find(item=>item.id===p.selectedGameId)).find(item=>item?.renderer_type==='declarative'&&item.allowed_player_counts?.length);
  const game=p.selectedGame||summary||null;
  const creating=useRef(false);
  const [computerPlayers,setComputerPlayers]=useState(2),[passPlayers,setPassPlayers]=useState(2),[stake,setStake]=useState(0),[speed,setSpeed]=useState(0);
  useEffect(()=>{if(game){const min=Math.min(...game.allowed_player_counts),counts=game.allowed_player_counts.filter(count=>count>1);setComputerPlayers(counts.length?Math.min(...counts):min);setPassPlayers(min);}},[game?.id,game?.version]);
  useEffect(()=>{
    if(Platform.OS==='web')return;
    const idle=requestIdleCallback(()=>{void import('./MatchStage').then(module=>module.preparePresentationRuntime()).catch(()=>{});});
    return ()=>cancelIdleCallback(idle);
  },[]);
  if(!game)return <Empty>{copyText("Loading game…")}</Empty>;
  const solo=game.allowed_player_counts.length===1&&game.allowed_player_counts[0]===1;
  const computerCounts=game.allowed_player_counts.filter(count=>count>1);
  const start=async(mode:'computer'|'online'|'pass')=>{
    if(!p.account){openAccount();return;}
    if(creating.current)return;
    creating.current=true;
    try {
      const computer=mode==='computer',players=computer?computerPlayers:passPlayers;
      const match=mode==='online'
        ? await p.actions.createMatch({game_id:game.id,match_kind:'multiplayer',bet_per_player:stake,turn_seconds:speed||null})
        : await p.actions.startPractice(game.id,{humans:computer?1:players,computers:computer?players-1:0,humanSeat:computer?Math.floor(Math.random()*players):0});
      showSelectedMatch(match.id);
    } finally {creating.current=false;}
  };
  return <>
    <Card style={{borderTopWidth:3,borderTopColor:colors.purple}}><Title>{game.name}</Title><Copy muted>{game.description}</Copy><Copy small style={{color:colors.blue}}>{game.allowed_player_counts.join(', ')} {copyText("players")}</Copy></Card>
    <Title small>{t('ui.portal.choose_play_mode','How would you like to play?')}</Title>
    <View style={s.columns}>
      {!solo&&<Card testID="play-computer" style={s.column}><Title small>{copyText('Play against the computer')}</Title><Copy muted>{copyText('A private match against computers, saved to your account. Your seat is chosen randomly.')}</Copy>
        {computerCounts.length>1&&<Choices label={t('ui.match.players','Players')} value={computerPlayers} options={computerCounts.map(value=>({value,label:String(value)}))} onChange={setComputerPlayers}/>}
        <Button onPress={()=>run(()=>start('computer'))}>{copyText('Play against the computer')}</Button>
        {!p.network&&!game.server_code&&<Copy small muted>{copyText('Connect once to download this game before playing offline.')}</Copy>}
      </Card>}
      {!solo&&<Card testID="play-online" style={s.column}><Title small>{copyText('Multiplayer')}</Title><Copy muted>{copyText('Play with other people, with no computer opponents. Share the invite so friends can join. Turn notifications keep everyone up to date.')}</Copy>
        {!solo && <><Choices label={t('ui.stakes.entry_per_player','Tokens per person')} value={stake} options={[0,1,5,10,50,100].map(value=>({value,label:value?`${value} ✦`:t('ui.stakes.free','Free')}))} onChange={setStake}/><Choices label={t('ui.speed.clock','Time per move')} value={speed} options={[{value:0,label:t('ui.speed.none','No clock')},...[60,180,300,600].map(value=>({value,label:`${value/60} min`}))]} onChange={setSpeed}/></>}
        {stake>0&&<Copy small muted>{copyText("Paid matches use your existing wallet and human players. Tokens are collected when the match starts.")}</Copy>}
        <Button onPress={()=>run(()=>start('online'))}>{copyText('Invite your friends to play')}</Button>
      </Card>}
      <Card testID="play-pass" style={s.column}><Title small>{solo?copyText('Single player'):t('ui.practice.pass','Pass and play')}</Title><Copy muted>{solo?copyText('A private game saved to your account.'):copyText('Take turns with friends on one device. Only your account owns and can see this match.')}</Copy>
        {game.allowed_player_counts.length>1&&<Choices label={t('ui.match.players','Players')} value={passPlayers} options={game.allowed_player_counts.map(value=>({value,label:String(value)}))} onChange={setPassPlayers}/>}
        <Button onPress={()=>run(()=>start('pass'))}>{solo?copyText('Start game'):t('ui.practice.pass','Pass and play')}</Button>
        {!p.network&&!game.server_code&&<Copy small muted>{copyText("Connect once to download this game before playing offline.")}</Copy>}
      </Card>
    </View>
    {(game.tutorial_text || game.game_logic_rules || game.game_ui_rules) && <Card><Title small>{t('ui.game.rules','How to play')}</Title><GameInstructions game={game}/></Card>}
  </>;
}

function MatchCard({match,local=false,carousel=false}: {match: Match;local?: boolean;carousel?: boolean}) {
  const {p,run,openMatch}=useApp(),t=useText();
  const name=matchGameName(match,p,copyText('Tic-tac-toe'))||t('ui.game.name_unavailable','Game name unavailable');
  const identity=(local?p.account?.id:p.profile?.id||p.account?.canonical_user_id||p.account?.id)||'visitor';
  const seat=match.players.find(player=>player.user_id===identity), turn=seat?.active!==false&&seat&&match.turn_of_player_indices?.includes(seat.player_index);
  const opponents=match.players.filter(player=>player.user_id!==identity).map(player=>player.name||p.profiles[player.user_id||'']?.display_name||(player.kind==='computer'?copyText('Computer {v0}',{v0:player.player_index+1}):copyText('Player {v0}',{v0:player.player_index+1})));
  const title=opponents.length?copyText('{v0} against {v1}',{v0:name,v1:opponents.join(', ')}):name;
  const [confirmation,setConfirmation]=useState<Match|null>(null),[preview,setPreview]=useState<Match|null>(null),[error,setError]=useState('');
  const scope=JSON.stringify([p.baseUrl,p.account?.id]),currentScope=useRef(scope);currentScope.current=scope;
  const intent=useRef(0);
  useEffect(()=>{intent.current++;setConfirmation(null);setPreview(null);setError('');},[scope]);
  useEffect(()=>()=>{intent.current++;},[]);
  const begin=()=>run(async()=>{const epoch=++intent.current,owner=scope;setError('');setPreview(null);const latest=local?match:await p.actions.request('GET',`/matches/${encodeURIComponent(match.id)}`);if(epoch===intent.current&&owner===currentScope.current)setConfirmation(latest);});
  const confirmAction=()=>run(async()=>{
    const target=confirmation,epoch=intent.current,owner=scope;if(!target||owner!==currentScope.current)return;
    try{
      if(!local&&target.status==='ongoing'&&!preview){const value=await p.actions.request('POST',`/matches/${encodeURIComponent(target.id)}/maybeLeave`);if(epoch===intent.current&&owner===currentScope.current)setPreview(value);return;}
      if(local)await p.actions.deleteLocal(target.id);else await p.actions.leaveMatch(target.id);
      if(epoch===intent.current&&owner===currentScope.current){intent.current++;setConfirmation(null);setPreview(null);await p.actions.refresh();}
    }catch(failure){if(epoch===intent.current&&owner===currentScope.current)setError(visibleErrorMessage(failure)??'');throw failure;}
  });
  const close=()=>{intent.current++;setConfirmation(null);setPreview(null);setError('');};
  const pending=Boolean(match.cloud_pending||match.pending||match.conflict),ended=match.status==='over',canLeave=local||Boolean(seat&&seat.active!==false);
  return <Card testID={`match-card-${match.id}`} style={{padding:16,...(carousel?{width:300,flexShrink:0}:{})}}><Pressable accessibilityRole="link" onPress={()=>run(()=>openMatch(match.id))} style={{gap:7}}><Row><Title small>{title}</Title><View style={{flex:1}}/><Copy small style={{color:turn?colors.accent:colors.blue}}>{turn?copyText("Your turn"):ended?copyText("Finished"):seat?.active===false?copyText('Left'):match.status==='waiting_for_players'?copyText("Waiting for players"):copyText("Ongoing")}</Copy></Row><Copy small muted>{matchKind(match)==='computer'?copyText('Against computers'):matchKind(match)==='pass_and_play'?copyText('Pass and play'):copyText('Multiplayer')}{' · '}{match.players.length} {copyText("players ·")} {match.move_count} {copyText("moves")}{match.turn_seconds?copyText(" · {v0} min per move",{v0:match.turn_seconds/60}):''}</Copy>{local&&<Copy small muted>{match.saving_on_device?copyText('Saving on this device…'):match.cloud_pending?copyText('Saved locally · waiting to sync'):copyText('Saved in the cloud')}{' · '}{copyText('Private to your account')}</Copy>}<MatchOutcome match={match}/></Pressable><Row><Button secondary compact onPress={()=>run(()=>openMatch(match.id))}>{t('ui.action.open','Open match')}</Button>{(ended||canLeave)&&(!local||!pending)&&<Button secondary compact disabled={pending||!p.network} onPress={begin}>{local||ended?t('ui.action.delete','Delete'):t('ui.action.leave','Leave')}</Button>}{local&&<RemoveSavedMatch match={match}/>}</Row>{pending&&!local&&<Copy small muted>{copyText('Sync or resolve pending actions before leaving or deleting this match.')}</Copy>}
    {confirmation&&<Dialog visible title={local||confirmation.status==='over'?copyText('Delete this match?'):copyText('Leave this match?')} onClose={close}>
      <Copy>{local?copyText('This deletes your private match from your account and this device.'):confirmation.status==='over'?copyText('This removes the match from your list. Other players can still see it.'):confirmation.status==='waiting_for_players'&&confirmation.owner_user_id===identity?copyText('Leaving closes this lobby for everyone and refunds any tokens.'):copyText('Your seat will leave the match. The server calculates any token settlement.')}</Copy>
      {preview&&<Copy>{copyText('Your payout:')} {preview.pending_leave_payout??0} {copyText('tokens')}</Copy>}
      {error&&<Notice error>{error}</Notice>}
      <Button danger onPress={confirmAction}>{local||confirmation.status==='over'?t('ui.action.delete','Delete'):!local&&confirmation.status==='ongoing'&&!preview?copyText('Preview leaving'):copyText('Confirm leaving')}</Button>
    </Dialog>}
  </Card>;
}

function MatchCarousel({matches,local=false,testID}: {matches: Match[];local?: boolean;testID: string}) {
  return <ScrollView testID={testID} horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:14,paddingBottom:6}}>{matches.map(match=><MatchCard key={match.id} match={match} local={local} carousel/>)}</ScrollView>;
}

function LocalMatchCarousels() {
  const {p}=useApp();
  const saved=singlePlayerMatches(p.myMatches,p.localMatches);
  const groups=[{id:'computer-local-matches',title:copyText('Play against the computer'),kind:'computer'},{id:'pass-local-matches',title:copyText('Pass and play'),kind:'pass_and_play'}];
  return <>{groups.map(group=>{const matches=saved.filter(match=>matchKind(match)===group.kind);return matches.length?<View key={group.id} testID={group.id} style={{gap:12}}><Title small>{group.title}</Title><MatchCarousel matches={matches} local testID={`${group.id}-carousel`}/></View>:null;})}</>;
}

function PreservedAppData() {
  const {p,run}=useApp();
  return p.archived.length>0?<Card><Title small>{copyText('Preserved previous app data')}</Title><Copy muted>{copyText('Saved games and pending branches are kept here for recovery. Copy them before clearing app data. Retired HTML moves cannot be submitted to current online matches.')}</Copy><Copy small>{p.archived.length} {copyText('saved records')}</Copy><Button secondary onPress={()=>run(async()=>{await Clipboard.setStringAsync(JSON.stringify(p.archived,null,2));})}>{copyText('Copy preserved data')}</Button></Card>:null;
}

export function Matches() {
  const {p,run,openAccount}=useApp(),t=useText();
  const multiplayer=p.myMatches.filter(match=>!isSinglePlayerMatch(match));
  const groups=[{id:'your-turn',title:copyText("Your turn"),matches:multiplayer.filter(m=>m.status==='ongoing'&&m.players.some(x=>x.user_id===p.account?.id&&m.turn_of_player_indices?.includes(x.player_index)))},{id:'ongoing',title:copyText("Ongoing"),matches:multiplayer.filter(m=>m.status==='ongoing'&&!m.players.some(x=>x.user_id===p.account?.id&&m.turn_of_player_indices?.includes(x.player_index)))},{id:'waiting',title:copyText("Waiting for players"),matches:multiplayer.filter(m=>m.status==='waiting_for_players')},{id:'finished',title:copyText("Finished"),matches:multiplayer.filter(m=>m.status==='over')}];
  return <><Title>{t('ui.portal.nav_matches','Matches')}</Title><Copy muted>{copyText('Every match is saved to your account. Single-player matches are private; multiplayer matches are shared with human players.')}</Copy>
    <LocalMatchCarousels/>
    {!p.account&&<Button onPress={openAccount}>{t('ui.auth.log_in','Log in to see your matches')}</Button>}

    {multiplayer.length>0&&<Title small>{copyText('Multiplayer')}</Title>}
    {groups.map(group=><View key={group.id} style={{gap:12}}><Title small>{group.title} · {group.matches.length}</Title>{group.matches.length?<MatchCarousel matches={group.matches} testID={`multiplayer-${group.id}-carousel`}/>:<Empty>{copyText("No matches here yet.")}</Empty>}</View>)}
    {p.cursors.myMatches&&<Button secondary onPress={()=>run(()=>p.actions.loadMore('myMatches'))}>{copyText("Load more matches")}</Button>}
    <PreservedAppData/>
  </>;
}

export function LocalMatches() {
  const {p,run,showSelectedMatch,openAccount}=useApp(),t=useText();
  const localOnly=useRef(readLocalUiTest()).current;
  const start=async(computers:number)=>{if(!p.account&&!localOnly){openAccount();return;}const match=await p.actions.startPractice('bundled-tictactoe',{humans:2-computers,computers,humanSeat:computers?Math.floor(Math.random()*2):0});showSelectedMatch(match.id);};
  return <><Title>{copyText('Single-player matches')}</Title><Copy muted>{copyText('Your private computer and pass-and-play matches save locally first and sync to the cloud. Download a game once, then keep playing offline.')}</Copy><LocalMatchCarousels/><Card><Title small>{copyText("Tic-tac-toe")}</Title><Copy muted>{copyText("A bundled game, ready to play offline on a fresh installation.")}</Copy><Row><Button onPress={()=>run(()=>start(0))}>{copyText("Pass and play")}</Button><Button secondary onPress={()=>run(()=>start(1))}>{copyText("Practice with a computer")}</Button></Row></Card>{!singlePlayerMatches(p.myMatches,p.localMatches).length&&<Empty>{copyText('No single-player matches yet. Choose a game to get started.')}</Empty>}
    <PreservedAppData/>
  </>;
}

const s=StyleSheet.create({eyebrow:{fontSize:12,letterSpacing:2,fontWeight:'700',color:colors.accent},grid:{flexDirection:'row',flexWrap:'wrap',gap:16},gameCard:{width:GAME_CARD_WIDTH,flexGrow:1,maxWidth:380,padding:18},cover:{width:'100%',height:132,borderRadius:8,backgroundColor:'#222a3d'},columns:{flexDirection:'row',flexWrap:'wrap',gap:18},column:{flex:1,minWidth:260}});
