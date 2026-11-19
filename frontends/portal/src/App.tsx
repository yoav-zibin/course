import {copyText} from './platform/i18n';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {usePortal} from './core';
import {Button, Card, Copy, Notice, Row, Title, colors} from './ui/components';
import {Context, Screen, text} from './ui/context';
import {Catalog, GameDetail, Matches, LocalMatches, Invitations, Settings} from './ui/screens';
import {AccountDialog} from './ui/AccountDialog';
import {MatchStage} from './ui/MatchStage';
import {BugReporter} from './ui/BugReporter';
import {BugButton} from './ui/BugButton';
import {recordDiagnosticPage,recordDiagnosticEvent,rememberDiagnosticSecrets} from './core/diagnostics';
import {installWebApp} from './ui/webApp';
import {EmbeddedGameHost} from './game/EmbeddedGameHost';
import {getDirection} from './platform/i18n';
import {configureReporter,createReporter,reportClientIssue} from './core/reporting';
import {ErrorBoundary} from './ui/ErrorBoundary';
import {readLocalUiTest} from './platform/legacy';

function PortalApp({p}: {p:ReturnType<typeof usePortal>}) {
  const {width} = useWindowDimensions();
  const localOnly=useRef(readLocalUiTest()).current;
  const [screen, setScreen] = useState<Screen>('games');
  const [account, setAccount] = useState(false), [focus,setFocus]=useState(false);
  const [notice, setNotice] = useState('');
  const [appSession,setAppSession] = useState('');
  const [pendingInvite,setPendingInvite]=useState(''),[invitePreview,setInvitePreview]=useState<any>(null);
  const [layout, setLayout] = useState<'top'|'left'>('top');
  const knownPasswords=useRef(new Set<string>());
  for(const saved of p.accounts)knownPasswords.current.add(saved.password);
  rememberDiagnosticSecrets(knownPasswords.current);
  useEffect(()=>recordDiagnosticPage({screen,gameId:p.selectedGameId,matchId:p.selectedMatch?.id,focus}),[screen,p.selectedGameId,p.selectedMatch?.id,focus]);
  useEffect(()=>{if(!p.selectedMatch)setFocus(false);},[p.selectedMatch?.id]);
  const t = (key: string, fallback: string) => text(p,key,fallback);
  const run = useCallback(async (task: () => Promise<unknown>) => {try { await task(); } catch (error) {setNotice(error instanceof Error ? error.message : String(error));}}, []);
  const writeRoute = (fragment: string) => { if (Platform.OS === 'web') {const url = new URL(window.location.href); url.hash = fragment; window.history.pushState(null, '', url);}};
  const navigate = (next: Screen) => {if(next==='games')p.actions.clearGame();else p.actions.clearMatch(); setScreen(next); writeRoute(next);};
  const openGame = async (id: string) => {await p.actions.selectGame(id); setScreen('games'); writeRoute(`game=${encodeURIComponent(id)}`);};
  const openMatch = async (id: string) => {await p.actions.selectMatch(id); setScreen('matches'); writeRoute(`match=${encodeURIComponent(id)}`);};
  const openInvite=async(token:string)=>{setPendingInvite(token);setInvitePreview(await p.actions.request('GET',`/invites/${encodeURIComponent(token)}`));};

  useEffect(() => {void run(async () => {
    const initialUrl=Platform.OS==='web'?window.location.href:(await Linking.getInitialURL())??null;
    await p.actions.bootstrap(undefined,localOnly,initialUrl??undefined);
    const savedLayout = await AsyncStorage.getItem('buildplay.navigation.v2');
    if (savedLayout === 'left') setLayout(savedLayout);
    if (Platform.OS === 'web') installWebApp();
    const receive = async (raw: string | null) => {
      if (!raw) return;
      const url = new URL(raw, 'https://buildplay.fun');
      const hash = new URLSearchParams(url.hash.slice(1)), query = url.searchParams;
      const id = hash.get('match') || query.get('match');
      const game = hash.get('game') || query.get('game');
      const invite = hash.get('invite') || query.get('invite');
      const appLogin = hash.get('app-login');
      if(appLogin){setAppSession(appLogin);return;}
      if (id) await openMatch(id);
      else if (game) await openGame(game);
      else if (invite) await openInvite(invite);
      else if (['games','matches','local','invites','settings'].includes(url.hash.slice(1))) setScreen(url.hash.slice(1) as Screen);
    };
    await receive(initialUrl);
  });}, []);
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({url}) => {void run(async () => {
      await p.actions.rememberAttribution(url);
      const parsed = new URL(url), hash = new URLSearchParams(parsed.hash.slice(1));
      const match = hash.get('match') || parsed.searchParams.get('match'), game = hash.get('game') || parsed.searchParams.get('game'), invite = hash.get('invite') || parsed.searchParams.get('invite');
      if (match) await openMatch(match); else if (game) await openGame(game); else if (invite) await openInvite(invite);
    });});
    const resume = AppState.addEventListener('change', state => {if (state === 'active') void run(() => p.actions.refresh());});
    const pop = () => {void run(async () => {await p.actions.rememberAttribution(window.location.href);const hash = new URLSearchParams(window.location.hash.slice(1)); const id=hash.get('match'), game=hash.get('game'); if(id) {setScreen('matches');await p.actions.selectMatch(id);} else {p.actions.clearGame(); if(game) {setScreen('games');await p.actions.selectGame(game);} else setScreen((['games','matches','local','invites','settings'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'games') as Screen);}});};
    if (Platform.OS === 'web') window.addEventListener('popstate',pop);
    return () => {subscription.remove(); resume.remove(); if (Platform.OS === 'web') window.removeEventListener('popstate',pop);};
  }, []);
  useEffect(()=>{
    if(!p.ready)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{if(AppState.currentState==='active'&&(Platform.OS!=='web'||!document.hidden)){if(p.selectedMatch)await p.actions.refreshMatch();else await p.actions.refresh();}}catch{/* Store exposes connection status and preserves the last board. */}finally{if(!stopped)timer=setTimeout(poll,p.selectedMatch?.status==='ongoing'?400:p.selectedMatch?2000:5000);}};
    timer=setTimeout(poll,1000);return()=>{stopped=true;clearTimeout(timer);};
  },[p.ready,p.selectedMatch?.id,p.selectedMatch?.status,p.account?.id]);
  useEffect(()=>{
    if(Platform.OS!=='android')return;
    const listener=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(account){setAccount(false);return true;}
      if(p.selectedMatch){navigate(p.selectedMatch.localMode?'local':'matches');return true;}
      if(p.selectedGameId){p.actions.clearGame();setScreen('games');return true;}
      if(screen!=='games'){navigate('games');return true;}
      return false;
    });return()=>listener.remove();
  },[account,screen,p.selectedMatch?.id,p.selectedGameId]);
  useEffect(()=>{
    if(!p.ready)return;
    if(localOnly){configureReporter(()=>{});return;}
    configureReporter(createReporter(p.baseUrl,()=>knownPasswords.current));
    if(Platform.OS==='web'){
      document.documentElement.lang=p.locale;document.documentElement.dir=getDirection();
      const error=(event:ErrorEvent)=>reportClientIssue('script_error',event.error||event.message);
      const rejection=(event:PromiseRejectionEvent)=>reportClientIssue('unhandled_rejection',event.reason);
      window.addEventListener('error',error);window.addEventListener('unhandledrejection',rejection);
      return()=>{window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',rejection);};
    }
    const errors=(globalThis as any).ErrorUtils,previous=errors?.getGlobalHandler?.();
    if(previous)errors.setGlobalHandler((error:Error,fatal:boolean)=>{reportClientIssue('script_error',error);previous(error,fatal);});
    return()=>{if(previous)errors.setGlobalHandler(previous);};
  },[p.ready,p.baseUrl,p.locale]);
  useEffect(()=>{if(p.storageError)reportClientIssue('storage_error',p.storageError);},[p.storageError]);

  const links: {key: Screen; label: string; icon: string}[] = [
    {key:'games',label:t('ui.portal.nav_games','Games'),icon:'◇'}, {key:'matches',label:t('ui.portal.nav_matches','Matches'),icon:'▦'},
    {key:'local',label:t('ui.practice.local_matches','On this device'),icon:'▣'}, {key:'invites',label:t('ui.invite.title','Invites'),icon:'↗'},
  ];
  const side = width >= 1000 && layout === 'left';
  const tabs = <Row style={side ? {flexDirection:'column',alignItems:'stretch'} : {gap:6}}>{links.map(link => <Button key={link.key} label={link.label} secondary compact selected={screen === link.key} onPress={() => navigate(link.key)}>{link.icon}  {link.label}{link.key==='matches' && p.myMatches.length ? ` · ${p.myMatches.length}` : ''}</Button>)}</Row>;
  const gameVisible = p.selectedMatch !== null;
  return <Context.Provider value={{p,notify:setNotice,run,openAccount:()=>setAccount(true),navigate,openGame,openMatch}}>
    <SafeAreaView style={[s.safe,{direction:getDirection()}]} edges={['top','bottom','left','right']}>
      <StatusBar style="light" />
      {!focus&&<View style={s.header}>
        <Pressable accessibilityRole="link" accessibilityLabel={copyText("BuildPlay home")} onPress={()=>navigate('games')} style={{flexShrink:0}}><Copy style={s.brand}>BuildPlay<Copy style={{color:colors.accent,fontSize:25}}>●</Copy></Copy></Pressable>
        {width >= 800 && !side && tabs}
        <View style={{flex:1}} />
        {p.account && <Copy small style={{color:colors.accent}}>{(p.profile?.token_balance ?? p.account.token_balance ?? 0).toLocaleString()} ✦</Copy>}
        <Button secondary compact disabled={!p.ready} onPress={()=>setAccount(true)} label={p.account ? copyText("Account menu") : copyText("Log in")}>{p.account?.display_name || t('ui.auth.log_in','Log in')}</Button>
      </View>}
      {!focus&&width < 800 && <ScrollView horizontal style={s.mobileTabs} contentContainerStyle={{gap:6,paddingHorizontal:12,paddingVertical:8}}>{links.map(link=><Button key={link.key} secondary compact selected={screen===link.key} onPress={()=>navigate(link.key)}>{link.label}</Button>)}</ScrollView>}
      <View style={{flex:1,flexDirection:'row',minHeight:0}}>
        {!focus&&side && <View style={s.sidebar}>{tabs}<View style={{flex:1}}/><Button secondary onPress={()=>navigate('settings')}>⚙ {t('ui.preferences.title','Preferences')}</Button></View>}
        <ScrollView style={{flex:1,minWidth:0}} contentContainerStyle={[s.content,{padding:gameVisible?0:width<600?14:28},gameVisible && {maxWidth:1500},focus&&{paddingTop:42}]} keyboardShouldPersistTaps="handled">
          {(notice || p.error) && <Notice error onDismiss={()=>{setNotice('');p.actions.clearError();}}>{notice || p.error}</Notice>}
          {p.storageError && <Notice error>{p.storageError}</Notice>}
          {(!p.network || p.pending>0) && <Notice>{p.network ? t('ui.offline.online','Online') : t('ui.offline.offline','Offline')} · {p.pending} {t('ui.offline.pending_moves','pending moves')}. {p.pending ? t('ui.offline.move_saved','Your move is saved on this device and will sync when connected.') : t('ui.offline.downloaded_play','Downloaded games are available on this device.')}</Notice>}
          {appSession&&<Card><Title small>{copyText("Continue to the BuildPlay app")}</Title><Copy muted>{copyText("Confirm the account you want to use in the app. Your password stays out of the browser callback link.")}</Copy><Button onPress={()=>run(async()=>{if(!p.account){setAccount(true);return;}const result=await p.actions.request('POST',`/auth/app-sessions/${encodeURIComponent(appSession)}/complete`);await Linking.openURL(result.callback_url);setAppSession('');})}>{p.account?copyText("Continue as {v0}",{v0:p.account.display_name}):copyText("Log in to continue")}</Button></Card>}
          {pendingInvite&&<Card><Title small>{invitePreview?.created_by_display_name?copyText("{v0} invited you to play",{v0:invitePreview.created_by_display_name}):copyText("You’re invited to play")}</Title><Copy muted>{p.account?copyText("Join the match with your current account."):copyText("Log in or continue as a guest, then join this match.")}</Copy><Row><Button onPress={()=>run(async()=>{if(!p.account){setAccount(true);return;}const joined=await p.actions.acceptInvite(pendingInvite);setPendingInvite('');setInvitePreview(null);setScreen('matches');writeRoute(`match=${encodeURIComponent(joined.id)}`);})}>{p.account?copyText("Join match"):copyText("Log in to join")}</Button><Button secondary onPress={()=>{setPendingInvite('');setInvitePreview(null);writeRoute('games');}}>{copyText("Not now")}</Button></Row></Card>}
          {!p.ready ? <View style={s.loading}><ActivityIndicator size="large" color={colors.accent}/><Copy muted>{copyText("Loading BuildPlay…")}</Copy></View>
            : gameVisible ? <MatchStage />
            : screen==='games' ? p.selectedGameId ? <GameDetail /> : <Catalog />
            : screen==='matches' ? <Matches />
            : screen==='local' ? <LocalMatches />
            : screen==='invites' ? <Invitations />
            : <Settings layout={layout} setLayout={next=>{setLayout(next); void AsyncStorage.setItem('buildplay.navigation.v2',next);}} />}
          {!focus&&<Row style={s.footer}><Copy small muted>BuildPlay</Copy><Button secondary compact onPress={()=>navigate('settings')}>{t('ui.preferences.title','Preferences')}</Button><Button secondary compact onPress={()=>Linking.openURL(`${p.baseUrl}/static/privacy.html`)}>{t('ui.privacy.title','Privacy')}</Button><Copy small muted>{p.network ? copyText("● Online") : copyText("○ Offline")}</Copy></Row>}
        </ScrollView>
      </View>
      <AccountDialog visible={account} onClose={()=>setAccount(false)} />
      {gameVisible&&<View style={{position:'absolute',right:8,top:2,zIndex:100}}><Button secondary compact onPress={()=>{setFocus(value=>!value);recordDiagnosticEvent('focus_mode',{enabled:!focus});}}>{focus?copyText('Exit focus mode'):copyText('Focus mode')}</Button></View>}
    </SafeAreaView>
  </Context.Provider>;
}
export default function App() {
  const p=usePortal();
  const embedded=Platform.OS==='web'?document.getElementById('declarative-spec'):null;
  return <SafeAreaProvider><ErrorBoundary>{embedded?<EmbeddedGameHost spec={JSON.parse(embedded.textContent||'null')}/>:<PortalApp p={p}/>}</ErrorBoundary><BugReporter p={p} screen={p.selectedMatch?'match':p.selectedGameId?'game':'portal'}/><BugButton/></SafeAreaProvider>;
}
const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background}, header:{minHeight:104,paddingHorizontal:20,paddingTop:38,paddingBottom:12,borderBottomWidth:1,borderColor:colors.border,backgroundColor:colors.surface,flexDirection:'row',alignItems:'center',gap:16,flexWrap:'wrap'},
  brand:{fontSize:25,fontWeight:'800',letterSpacing:-1},
  mobileTabs:{maxHeight:58,flexGrow:0,backgroundColor:colors.surface}, sidebar:{width:230,backgroundColor:colors.surface,padding:18,gap:12,borderRightWidth:1,borderColor:colors.border},
  content:{width:'100%',maxWidth:1240,alignSelf:'center',gap:22,flexGrow:1},loading:{minHeight:300,alignItems:'center',justifyContent:'center',gap:20},footer:{marginTop:28,paddingTop:22,paddingBottom:20,borderTopWidth:1,borderColor:colors.border,justifyContent:'center'},
});
