import {copyText} from '../platform/i18n';
import React, {useEffect, useState} from 'react';
import {Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {getLocales} from '../platform/i18n';
import type {Game, Match} from '../core/types';
import {Button, Card, Choices, Copy, Dialog, Empty, Field, Notice, Row, Title, colors} from './components';
import {text, useApp} from './context';
import {FeedbackDialog} from './FeedbackDialog';
import {MatchOutcome} from './MatchOutcome';
import {GameInstructions} from './GameInstructions';
import {enableNotifications, installPrompt} from './webApp';

function useText() {const {p} = useApp(); return (key: string, fallback: string) => text(p,key,fallback);}
function gameName(game: Game | undefined, id: string) {return game?.name || id.slice(0,8);}
function GameCard({game}: {game: Game}) {
  const {p,openGame,run} = useApp();
  const saved = p.savedGames.some(item=>item.id===game.id);
  return <Card style={s.gameCard}><Pressable accessibilityRole="link" accessibilityLabel={copyText("Play {v0}",{v0:game.name})} onPress={()=>run(()=>openGame(game.id))} style={{gap:12}}>
    {game.cover_url ? <Image source={{uri:new URL(game.cover_url,p.baseUrl).href}} style={s.cover} resizeMode="contain" accessibilityLabel={game.name}/> : <View style={[s.cover,{alignItems:'center',justifyContent:'center'}]}><Copy style={{fontSize:44,color:colors.blue}}>◇</Copy></View>}
    <Title small>{game.name}</Title><Copy small muted numberOfLines={3}>{game.description}</Copy>
    <Copy small style={{color:colors.blue}}>{game.allowed_player_counts?.join(', ')} {copyText("players")}</Copy>
  </Pressable><Row><Button compact onPress={()=>run(()=>openGame(game.id))}>{copyText("Play")}</Button>{p.account && <Button compact secondary label={`${saved?copyText("Unsave"):copyText("Save")} ${game.name}`} onPress={()=>run(()=>p.actions.saveGame(game.id,!saved))}>{saved?copyText("★ Saved"):copyText("☆ Save")}</Button>}</Row></Card>;
}

export function Catalog() {
  const {p,run,openAccount} = useApp(), t=useText();
  const [query,setQuery]=useState(p.query), [filter,setFilter]=useState('all'), [proposal,setProposal]=useState(false);
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[rules,setRules]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>{if(query!==p.query) void run(()=>p.actions.searchGames(query));},350); return()=>clearTimeout(timer);},[query]);
  const games=filter==='saved'?p.savedGames:p.games;
  return <>
    <View style={{gap:10}}><Copy small style={s.eyebrow}>{copyText("YOUR NEXT GOOD GAME")}</Copy><Title>{t('ui.games.title','Let’s play.')}</Title><Copy muted>{t('ui.games.subtitle','Discover a game, invite your friends, or play on this device. Pick up the same match on web, iPhone, and Android.')}</Copy></View>
    {!p.account && <Card><Title small>{t('ui.auth.welcome','Make yourself at home')}</Title><Copy muted>{t('ui.portal.login_note','Log in or continue as a guest to create and join matches.')}</Copy><Row><Button onPress={openAccount}>{t('ui.auth.log_in','Log in / continue as guest')}</Button><Copy small muted>{copyText("Local play also works without an account.")}</Copy></Row></Card>}
    <Field label={t('ui.games.search','Search games')} placeholder={t('ui.games.search_placeholder','Find a game…')} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={()=>run(()=>p.actions.searchGames(query))}/>
    <Row><Button compact secondary selected={filter==='all'} onPress={()=>setFilter('all')}>{t('ui.library.all','All games')}</Button><Button compact secondary selected={filter==='saved'} onPress={()=>{setFilter('saved'); if(!p.account)openAccount();}}>{t('ui.library.saved','Saved games')}</Button><View style={{flex:1}}/><Button compact secondary onPress={()=>run(()=>p.actions.refresh())}>{t('ui.action.refresh','Refresh')}</Button></Row>
    {!query && filter==='all' && p.recentGames.length>0 && <><Title small>{t('ui.games.recent','Recently played')}</Title><ScrollView horizontal contentContainerStyle={{gap:14}}>{p.recentGames.map(game=><GameCard key={game.id} game={game}/>)}</ScrollView></>}
    {!query && filter==='all' && p.popularGames.length>0 && <><Title small>{t('ui.games.popular','Popular games')}</Title><ScrollView horizontal contentContainerStyle={{gap:14}}>{p.popularGames.map(game=><GameCard key={game.id} game={game}/>)}</ScrollView></>}
    <Title small>{filter==='saved'?t('ui.library.saved','Saved games'):t('ui.library.all','All games')}</Title>
    <View style={s.grid}>{games.map(game=><GameCard key={game.id} game={game}/>)}</View>
    {!games.length && <Empty>{p.loading?t('ui.action.loading','Loading games…'):t('ui.games.empty','No games found. Try another search.')}</Empty>}
    {p.cursors[filter==='saved'?'savedGames':'games'] && <Button secondary onPress={()=>run(()=>p.actions.loadMore(filter==='saved'?'savedGames':'games'))}>{t('ui.action.more','Load more games')}</Button>}
    <Card><Title small>{t('ui.proposal.title','Missing a game? Propose it')}</Title><Copy muted>{t('ui.proposal.explainer','Tell us which game you would like to play here. Our AI agents will review your proposal and create the game within 24 hours.')}</Copy><Row><Button secondary onPress={()=>setProposal(true)}>{t('ui.proposal.submit','Propose a game')}</Button></Row></Card>
    <Dialog visible={proposal} title={t('ui.proposal.title','Propose a game')} onClose={()=>setProposal(false)}>
      <Field label={t('ui.proposal.name_label','Game name')} value={name} onChangeText={setName} maxLength={120}/><Field label={t('ui.proposal.description_label','Why this game?')} multiline value={description} onChangeText={setDescription} maxLength={2000}/><Field label={t('ui.proposal.rules_label','Link to the rules (optional)')} value={rules} onChangeText={setRules} autoCapitalize="none" keyboardType="url"/>
      <Button disabled={!name.trim()} onPress={()=>run(async()=>{await p.actions.request('POST','/game-proposals',{name:name.trim(),description:description.trim(),rules_url:rules.trim(),proposer_name:p.account?.display_name||''});setProposal(false);setName('');})}>{t('ui.proposal.submit','Submit proposal')}</Button>
    </Dialog>
  </>;
}

export function GameDetail() {
  const {p,run,openAccount,openMatch} = useApp(),t=useText();
  const game=p.selectedGame;
  const [computers,setComputers]=useState(0),[humans,setHumans]=useState(2),[stake,setStake]=useState(0),[speed,setSpeed]=useState(0),[privateMatch,setPrivate]=useState(true),[feedback,setFeedback]=useState(false);
  useEffect(()=>{if(game){const min=Math.min(...game.allowed_player_counts);setHumans(min);setComputers(min===1?0:Math.max(0,min-1));}},[game?.id]);
  if(!game)return <Empty>{copyText("Loading game…")}</Empty>;
  const solo=game.allowed_player_counts.length===1&&game.allowed_player_counts[0]===1;
  const start=async(local=false,computer=false)=>{let match;if(local){match=await p.actions.startPractice(game.id,{humans:computer?1:humans,computers:computer?Math.max(0,Math.min(...game.allowed_player_counts)-1):0});}else{if(!p.account){openAccount();return;}match=await p.actions.createMatch({game_id:game.id,num_computer_opponents:computers,private:privateMatch,bet_per_player:solo?0:stake,turn_seconds:solo||!speed?null:speed});}await openMatch(match.id);};
  return <>
    <Row><Button secondary compact onPress={()=>p.actions.clearGame()}>← {t('ui.portal.back_to_games','All games')}</Button><View style={{flex:1}}/><Button secondary compact onPress={()=>setFeedback(true)}>{t('ui.feedback.game','Feedback on this game')}</Button></Row>
    <Card style={{borderTopWidth:3,borderTopColor:colors.purple}}><Title>{game.name}</Title><Copy muted>{game.description}</Copy><Copy small style={{color:colors.blue}}>{game.allowed_player_counts.join(', ')} {copyText("players · v")}{game.version}</Copy></Card>
    <Title small>{t('ui.portal.choose_play_mode','How would you like to play?')}</Title>
    <View style={s.columns}>
      <Card style={s.column}><Title small>{t('ui.portal.online_play','Play online')}</Title><Copy muted>{t('ui.portal.online_hint','Create a match for friends or computer opponents. Everyone shares the same match across devices.')}</Copy>
        {!solo && <Choices label={t('ui.portal.computers','Computer opponents')} value={computers} options={Array.from({length:Math.max(...game.allowed_player_counts)},(_,n)=>({value:n,label:String(n)}))} onChange={value=>{setComputers(value);if(value)setStake(0);}}/>}
        <Choices label={t('ui.match.visibility','Who can join?')} value={privateMatch?'private':'public'} options={[{value:'private',label:t('ui.match.private','Invite only')},{value:'public',label:t('ui.match.public','Public lobby')}]} onChange={value=>setPrivate(value==='private')}/>
        {!solo && <><Choices label={t('ui.stakes.entry_per_player','Tokens per person')} value={stake} options={[0,1,5,10,50,100].map(value=>({value,label:value?`${value} ✦`:t('ui.stakes.free','Free')}))} onChange={value=>{setStake(value);if(value)setComputers(0);}}/><Choices label={t('ui.speed.clock','Time per move')} value={speed} options={[{value:0,label:t('ui.speed.none','No clock')},...[60,180,300,600].map(value=>({value,label:`${value/60} min`}))]} onChange={setSpeed}/></>}
        {stake>0&&<Copy small muted>{copyText("Paid matches use your existing wallet and human players. Tokens are collected when the match starts.")}</Copy>}
        <Button disabled={!p.network} onPress={()=>run(()=>start())}>{t('ui.portal.create_match','Create match')}</Button>
        {!solo&&<Button secondary disabled={!p.network} onPress={()=>run(async()=>{if(!p.account){openAccount();return;}const match=await p.actions.quickMatch(game.id,Math.min(...game.allowed_player_counts));await openMatch(match.id);})}>{t('ui.portal.quick_match','Find an open match')}</Button>}
      </Card>
      <Card style={s.column}><Title small>{t('ui.practice.on_device','Play on this device')}</Title><Copy muted>{t('ui.practice.explainer','Play a downloaded game offline. Local matches stay on this device and do not change online matches.')}</Copy>
        {!solo&&<Choices label={t('ui.practice.humans','People sharing this device')} value={humans} options={game.allowed_player_counts.map(value=>({value,label:String(value)}))} onChange={setHumans}/>}
        <Button onPress={()=>run(()=>start(true,false))}>{solo?t('ui.practice.start','Start local game'):t('ui.practice.pass','Pass and play')}</Button>
        {!solo&&<Button secondary onPress={()=>run(()=>start(true,true))}>{t('ui.practice.computer','Practice with computers')}</Button>}
        {!p.network&&!game.server_code&&<Copy small muted>{copyText("Connect once to download this game before playing offline.")}</Copy>}
      </Card>
    </View>
    {(game.tutorial_text || game.game_logic_rules || game.game_ui_rules) && <Card><Title small>{t('ui.game.rules','How to play')}</Title><GameInstructions game={game}/></Card>}
    <FeedbackDialog visible={feedback} onClose={()=>setFeedback(false)} target={{type:'game',id:game.id,name:game.name}}/>
  </>;
}

function MatchCard({match,local=false}: {match: Match;local?: boolean}) {
  const {p,run,openMatch}=useApp(),t=useText();
  const game=p.games.find(item=>item.id===match.game_id)||p.savedGames.find(item=>item.id===match.game_id);
  const seat=match.players.find(player=>player.user_id===p.account?.id), turn=seat&&match.turn_of_player_indices?.includes(seat.player_index);
  return <Card style={{padding:16}}><Pressable accessibilityRole="link" onPress={()=>run(()=>openMatch(match.id))} style={{gap:7}}><Row><Title small>{gameName(game,match.game_id)}</Title><View style={{flex:1}}/><Copy small style={{color:turn?colors.accent:colors.blue}}>{local?copyText("On this device"):turn?copyText("Your turn"):match.status==='waiting_for_players'?copyText("Waiting for players"):match.status==='over'?copyText("Finished"):copyText("Ongoing")}</Copy></Row><Copy small muted>{match.players.length} {copyText("players ·")} {match.move_count} {copyText("moves")}{match.private?copyText(" · Invite only"):''}{match.turn_seconds?copyText(" · {v0} min per move",{v0:match.turn_seconds/60}):''}</Copy><MatchOutcome match={match}/></Pressable><Row><Button secondary compact onPress={()=>run(()=>openMatch(match.id))}>{t('ui.action.open','Open match')}</Button><Button secondary compact disabled={!local&&Boolean(match.pending||match.conflict)} onPress={()=>run(()=>local?p.actions.deleteLocal(match.id):p.actions.archiveMatch(match.id))}>{t('ui.action.hide','Hide from list')}</Button></Row>{!local&&Boolean(match.pending||match.conflict)&&<Copy small muted>{copyText('Sync or resolve pending actions before hiding this match.')}</Copy>}</Card>;
}

export function Matches() {
  const {p,run,openAccount,openMatch}=useApp(),t=useText();const [link,setLink]=useState('');
  const groups=[{title:copyText("Your turn"),matches:p.myMatches.filter(m=>m.status==='ongoing'&&m.players.some(x=>x.user_id===p.account?.id&&m.turn_of_player_indices?.includes(x.player_index)))},{title:copyText("Ongoing"),matches:p.myMatches.filter(m=>m.status==='ongoing'&&!m.players.some(x=>x.user_id===p.account?.id&&m.turn_of_player_indices?.includes(x.player_index)))},{title:copyText("Waiting for players"),matches:p.myMatches.filter(m=>m.status==='waiting_for_players')},{title:copyText("Finished"),matches:p.myMatches.filter(m=>m.status==='over')}];
  return <><Title>{t('ui.portal.nav_matches','Matches')}</Title><Copy muted>{t('ui.matches.subtitle','Jump back into a game or find a new lobby.')}</Copy>
    {!p.account&&<Button onPress={openAccount}>{t('ui.auth.log_in','Log in to see your matches')}</Button>}
    <Card><Field label={t('ui.match.paste_link','Open a match or invite link')} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false}/><Button secondary disabled={!link.trim()} onPress={()=>run(async()=>{const url=new URL(link,p.baseUrl);if(!['https:','http:','buildplay:'].includes(url.protocol)||(['https:','http:'].includes(url.protocol)&&url.origin!==new URL(p.baseUrl).origin))throw new Error('Use a match link from this server.');const hash=new URLSearchParams(url.hash.slice(1));const invite=hash.get('invite')||url.searchParams.get('invite'),id=hash.get('match')||url.searchParams.get('match');if(invite)await p.actions.acceptInvite(invite);else if(id)await openMatch(id);else throw new Error('This link has no match or invite.');})}>{t('ui.action.open','Open link')}</Button></Card>
    {groups.map(group=><View key={group.title} style={{gap:12}}><Title small>{group.title} · {group.matches.length}</Title>{group.matches.map(match=><MatchCard key={match.id} match={match}/>)}{!group.matches.length&&<Empty>{copyText("No matches here yet.")}</Empty>}</View>)}
    {p.cursors.myMatches&&<Button secondary onPress={()=>run(()=>p.actions.loadMore('myMatches'))}>{copyText("Load more matches")}</Button>}
    <Title small>{t('ui.section.open_matches','Open matches you can join')}</Title>{p.openMatches.map(match=><MatchCard key={match.id} match={match}/>)}{!p.openMatches.length&&<Empty>{copyText("No open matches right now. Create a public match to invite someone.")}</Empty>}
    {p.cursors.openMatches&&<Button secondary onPress={()=>run(()=>p.actions.loadMore('openMatches'))}>{copyText("Load more open matches")}</Button>}
  </>;
}

export function LocalMatches() {
  const {p,run,openGame}=useApp(),t=useText();
  return <><Title>{t('ui.practice.local_matches','On this device')}</Title><Copy muted>{copyText("Local games are saved here, including after you close the app. Download a game once to play without internet.")}</Copy><Card><Title small>{copyText("Tic-tac-toe")}</Title><Copy muted>{copyText("A bundled game, ready to play offline on a fresh installation.")}</Copy><Row><Button onPress={()=>run(()=>p.actions.startPractice('bundled-tictactoe',{humans:2,computers:0}))}>{copyText("Pass and play")}</Button><Button secondary onPress={()=>run(()=>p.actions.startPractice('bundled-tictactoe',{humans:1,computers:1}))}>{copyText("Practice with a computer")}</Button></Row></Card>{p.localMatches.map(match=><MatchCard key={match.id} match={match} local/>)}{!p.localMatches.length&&<Empty>{copyText("No local matches yet. Choose a game and select Pass and play or Practice with computers.")}</Empty>}
    {p.archived.length>0&&<Card><Title small>{copyText("Preserved previous app data")}</Title><Copy muted>{copyText("Saved games and pending branches from the previous app are preserved for review. Retired HTML moves cannot be submitted to current online matches.")}</Copy><Copy small>{p.archived.length} {copyText("saved records")}</Copy><Button secondary onPress={()=>run(async()=>{await Clipboard.setStringAsync(JSON.stringify(p.archived,null,2));})}>{copyText("Copy preserved data")}</Button></Card>}
  </>;
}

export function Invitations() {
  const {p,run,notify,openAccount}=useApp(),t=useText();const [token,setToken]=useState('');
  return <><Title>{t('ui.invite.title','Invites')}</Title><Copy muted>{copyText("Invite links let friends join a match, including invite-only matches.")}</Copy>{!p.account&&<Button onPress={openAccount}>{copyText("Log in to use an invite")}</Button>}
    <Card><Field label={copyText("Invite link or token")} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false}/><Button disabled={!token.trim()||!p.account} onPress={()=>run(async()=>{let value=token.trim();if(value.includes('://')){const url=new URL(value);if(url.origin!==new URL(p.baseUrl).origin)throw new Error('Use an invite from this server.');value=new URLSearchParams(url.hash.slice(1)).get('invite')||url.searchParams.get('invite')||'';}if(!value)throw new Error('This link has no invite token.');await p.actions.acceptInvite(value);})}>{copyText("Join match")}</Button></Card>
    {p.invites.map(invite=><Card key={invite.token}><Copy selectable>{invite.url}</Copy><Copy small muted>{invite.revoked?copyText("Revoked"):copyText("{v0} accepted",{v0:invite.acceptances?.length||0})}{invite.expires_at?copyText(" · Expires {v0}",{v0:new Date(invite.expires_at).toLocaleString()}):''}</Copy><Row><Button secondary compact onPress={()=>run(async()=>{await Clipboard.setStringAsync(invite.url);notify(copyText("Invite link copied."));})}>{copyText("Copy invite")}</Button>{!invite.revoked&&<Button danger compact onPress={()=>run(()=>p.actions.revokeInvite(invite.token))}>{copyText("Revoke invite")}</Button>}</Row></Card>)}
    {!p.invites.length&&<Empty>{copyText("No invites yet. Open a match and choose Share match.")}</Empty>}
    {p.cursors.invites&&<Button secondary onPress={()=>run(()=>p.actions.loadMore('invites'))}>{copyText("Load more invites")}</Button>}
  </>;
}

export function Settings({layout,setLayout}: {layout:'top'|'left';setLayout:(value:'top'|'left')=>void}) {
  const {p,run,notify}=useApp(),t=useText();
  return <><Title>{t('ui.preferences.title','Preferences')}</Title><Card><Choices label={copyText("Navigation layout")} value={layout} options={[{value:'top',label:copyText("Top navigation")},{value:'left',label:copyText("Left navigation")}]} onChange={setLayout}/><Choices label={t('ui.language.label','Language')} value={p.locale} options={getLocales().map(item=>({value:item.code,label:item.native_name||item.name||item.code}))} onChange={value=>run(()=>p.actions.setLocale(value))}/></Card>
    <Card><Title small>{copyText("Offline storage")}</Title><Copy muted>{copyText("Downloaded game packages and local matches are saved per account. A pending online action keeps its original request ID until the server confirms it. Conflicts preserve your saved branch.")}</Copy><Copy small>{p.localMatches.length} {copyText("local matches ·")} {p.pending} {copyText("pending actions ·")} {Object.keys(p.conflicts).length} {copyText("conflicts")}</Copy><Button secondary onPress={()=>run(()=>p.actions.refresh())}>{copyText("Sync now")}</Button></Card>
    {Platform.OS==='web'&&<Card><Title small>{copyText("Install & notifications")}</Title><Copy muted>{copyText("Add BuildPlay to your home screen for quick access and offline local games.")}</Copy><Button secondary onPress={()=>run(async()=>{const shown=await installPrompt();if(!shown)notify(copyText("Use your browser’s “Install app” or “Add to Home Screen” option."));})}>{copyText("Install BuildPlay")}</Button><Button secondary disabled={!p.account} onPress={()=>run(()=>enableNotifications(p))}>{copyText("Enable turn notifications")}</Button></Card>}
    <Card><Title small>{copyText("About BuildPlay")}</Title><Copy muted>{copyText("The same player app and game presentation on web, iPhone, and Android. Match rules, online turns, and token balances are validated by the server.")}</Copy><Copy small selectable>{copyText("Version 2.0.0 ·")} {p.baseUrl}</Copy></Card>
  </>;
}
const s=StyleSheet.create({eyebrow:{fontSize:12,letterSpacing:2,fontWeight:'700',color:colors.accent},grid:{flexDirection:'row',flexWrap:'wrap',gap:16},gameCard:{width:265,flexGrow:1,maxWidth:380,padding:18},cover:{width:'100%',height:132,borderRadius:8,backgroundColor:'#222a3d'},columns:{flexDirection:'row',flexWrap:'wrap',gap:18},column:{flex:1,minWidth:260}});
