import {copyText} from './platform/i18n';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, BackHandler, Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import {SafeAreaProvider, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {usePortal} from './core';
import {Button, Card, Copy, Notice, Row, Title, colors} from './ui/components';
import {Context, Screen, text} from './ui/context';
import {Catalog, GameDetail, Matches, LocalMatches, Invitations, Settings} from './ui/screens';
import {AccountDialog} from './ui/AccountDialog';
import {AccountDeletionBanner} from './ui/AccountDeletion';
import {PrivacyDialog} from './ui/PrivacyDialog';
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
import {notificationTarget} from './core/notifications';
import type {InAppNotification} from './core/types';
import {useNotificationDelivery} from './ui/useNotificationDelivery';
import {NotificationInbox, NotificationPrompt} from './ui/Notifications';
import {PortalHeader} from './ui/PortalHeader';

function PortalApp({p}: {p:ReturnType<typeof usePortal>}) {
  const {width} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const localOnly=useRef(readLocalUiTest()).current;
  const [screen, setScreen] = useState<Screen>('games');
  const [account, setAccount] = useState(false), [focus,setFocus]=useState(false), [privacy,setPrivacy]=useState(false);
  const [notice, setNotice] = useState('');
  const [inbox,setInbox] = useState(false), [notificationBanner,setNotificationBanner] = useState<InAppNotification|null>(null);
  const observedNotifications = useRef<{scope:string; ids:Set<string>; initialized:boolean}>({scope:'',ids:new Set(),initialized:false});
  const [appSession,setAppSession] = useState('');
  const [pendingInvite,setPendingInvite]=useState(''),[invitePreview,setInvitePreview]=useState<any>(null);
  const [layout, setLayout] = useState<'top'|'left'>('top');
  const knownPasswords=useRef(new Set<string>());
  const notificationScope = useRef(''); notificationScope.current = JSON.stringify([p.baseUrl,p.account?.id]);
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

  const openNotificationUrl = async (raw: string) => {
    const scope = notificationScope.current, guard = () => {if (scope !== notificationScope.current) throw new Error('Account changed; refresh to continue.');};
    const target = notificationTarget(raw, p.baseUrl); if (!target) throw new Error(copyText('This notification link is unavailable.'));
    if (target.kind === 'invite') {const preview = await p.actions.request('GET', `/invites/${encodeURIComponent(target.id)}`); guard(); setPendingInvite(target.id); setInvitePreview(preview);}
    else if (target.kind === 'rematch') {const next = await p.actions.request('POST', `/matches/${encodeURIComponent(target.id)}/rematch`); guard(); await openMatch(next.id);}
    else await openMatch(target.id);
  };
  const notificationDelivery = useNotificationDelivery(p, openNotificationUrl, setNotice, localOnly);
  const openNotification = async (item: InAppNotification) => {
    await openNotificationUrl(item.url);
    await p.actions.readNotification(item.id);
    setInbox(false); setNotificationBanner(null);
  };
  useEffect(() => {
    setInbox(false); setNotificationBanner(null);
    observedNotifications.current = {scope:JSON.stringify([p.baseUrl,p.account?.id]),ids:new Set(),initialized:false};
  }, [p.baseUrl,p.account?.id]);
  useEffect(() => {
    if (!p.ready || !p.account || localOnly) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {if (AppState.currentState === 'active' && (Platform.OS !== 'web' || !document.hidden)) await p.actions.refreshNotifications();}
      catch { /* Keep the last inbox available during a lost connection. */ }
      finally {if (!stopped) timer = setTimeout(poll,8000);}
    };
    void poll(); return () => {stopped = true; clearTimeout(timer);};
  }, [p.ready,p.baseUrl,p.account?.id]);
  useEffect(() => {
    const observed = observedNotifications.current;
    const fresh = p.notifications.find(item => !item.read_at && !observed.ids.has(item.id));
    if (observed.initialized && fresh) setNotificationBanner(fresh);
    if (p.notifications.length || p.ready) observed.initialized = true;
    for (const item of p.notifications) observed.ids.add(item.id);
  }, [p.notifications]);
  useEffect(() => {
    if (!p.notificationPrompt || p.notificationPromptReady || !notificationDelivery.status) return;
    if (notificationDelivery.status.subscribed || ['denied','unavailable'].includes(notificationDelivery.status.permission)) p.actions.dismissNotificationPrompt();
    else void p.actions.claimNotificationPrompt().catch(() => p.actions.dismissNotificationPrompt());
  }, [p.notificationPrompt,p.notificationPromptReady,notificationDelivery.status]);

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
      const invite = hash.get('invite') || query.get('invite') || /^\/i\/([^/]+)$/.exec(url.pathname)?.[1];
      const rematch = hash.get('rematch') || query.get('rematch');
      const appLogin = hash.get('app-login');
      if(appLogin){setAppSession(appLogin);return;}
      if (rematch) {const next = await p.actions.request('POST', `/matches/${encodeURIComponent(rematch)}/rematch`); await openMatch(next.id);}
      else if (id) await openMatch(id);
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
      const match = hash.get('match') || parsed.searchParams.get('match'), game = hash.get('game') || parsed.searchParams.get('game'), invite = hash.get('invite') || parsed.searchParams.get('invite') || /^\/i\/([^/]+)$/.exec(parsed.pathname)?.[1], rematch = hash.get('rematch') || parsed.searchParams.get('rematch');
      if (rematch) {const next = await p.actions.request('POST', `/matches/${encodeURIComponent(rematch)}/rematch`); await openMatch(next.id);} else if (match) await openMatch(match); else if (game) await openGame(game); else if (invite) await openInvite(invite);
    });});
    const resume = AppState.addEventListener('change', state => {if (state === 'active') void run(() => p.actions.refresh());});
    const pop = () => {void run(async () => {await p.actions.rememberAttribution(window.location.href);const hash = new URLSearchParams(window.location.hash.slice(1)); const id=hash.get('match'), game=hash.get('game'), invite=hash.get('invite'), rematch=hash.get('rematch'); if(rematch) {const next=await p.actions.request('POST',`/matches/${encodeURIComponent(rematch)}/rematch`);await openMatch(next.id);} else if(invite) await openInvite(invite); else if(id) {setScreen('matches');await p.actions.selectMatch(id);} else {p.actions.clearGame(); if(game) {setScreen('games');await p.actions.selectGame(game);} else setScreen((['games','matches','local','invites','settings'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'games') as Screen);}});};
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
      if(privacy){setPrivacy(false);return true;}
      if(account){setAccount(false);return true;}
      if(p.selectedMatch){navigate(p.selectedMatch.localMode?'local':'matches');return true;}
      if(p.selectedGameId){p.actions.clearGame();setScreen('games');return true;}
      if(screen!=='games'){navigate('games');return true;}
      return false;
    });return()=>listener.remove();
  },[privacy,account,screen,p.selectedMatch?.id,p.selectedGameId]);
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
  const inlineNavigation=width>=1280&&!side;
  const tabs = <Row style={side ? {flexDirection:'column',alignItems:'stretch'} : {gap:6,flexWrap:'nowrap'}}>{links.map(link => <Button key={link.key} label={link.label} secondary compact selected={screen === link.key} onPress={() => navigate(link.key)}>{link.icon}  {link.label}{link.key==='matches' && p.myMatches.length ? ` · ${p.myMatches.length}` : ''}</Button>)}</Row>;
  const gameVisible = p.selectedMatch !== null;
  // New destinations start at the top; updates within a match keep its position.
  const contentKey = gameVisible ? `match:${p.selectedMatch!.id}` : screen === 'games' && p.selectedGameId ? `game:${p.selectedGameId}` : screen;
  const toggleFocus=()=>{setFocus(value=>!value);recordDiagnosticEvent('focus_mode',{enabled:!focus});};
  return <Context.Provider value={{p,notificationDelivery,notify:setNotice,run,openAccount:()=>setAccount(true),navigate,openGame,openMatch}}>
    <SafeAreaView style={[s.safe,{direction:getDirection()}]} edges={['top','bottom','left','right']}>
      <StatusBar style="light" />
      {!focus&&<PortalHeader width={width} locale={p.locale} baseUrl={p.baseUrl} account={p.account} balance={p.profile?.token_balance??p.account?.token_balance??0} unread={p.unreadNotifications} ready={p.ready} gameVisible={gameVisible} navigation={inlineNavigation?tabs:undefined}
        onHome={()=>navigate('games')} onAccount={()=>setAccount(true)} onNotifications={()=>{setInbox(true);void p.actions.refreshNotifications().catch(()=>{});}} onFocus={toggleFocus}/>}
      {!focus&&!side&&!inlineNavigation&&<ScrollView horizontal style={s.mobileTabs} contentContainerStyle={{gap:6,paddingHorizontal:12,paddingVertical:8}}>{links.map(link=><Button key={link.key} secondary compact selected={screen===link.key} onPress={()=>navigate(link.key)}>{link.label}</Button>)}</ScrollView>}
      <AccountDeletionBanner/>
      <View style={{flex:1,flexDirection:'row',minHeight:0}}>
        {!focus&&side && <View style={s.sidebar}>{tabs}<View style={{flex:1}}/><Button secondary onPress={()=>navigate('settings')}>⚙ {t('ui.preferences.title','Preferences')}</Button></View>}
        <ScrollView key={contentKey} style={{flex:1,minWidth:0}} contentContainerStyle={[s.content,{padding:gameVisible?0:width<600?14:28},gameVisible && {maxWidth:1500},focus&&{paddingTop:42}]} keyboardShouldPersistTaps="handled">
          {(notice || p.error) && <Notice error onDismiss={()=>{setNotice('');p.actions.clearError();}}>{notice || p.error}</Notice>}
          {p.storageError && <Notice error>{p.storageError}</Notice>}
          {(!p.network || p.pending>0) && <Notice>{p.network ? t('ui.offline.online','Online') : t('ui.offline.offline','Offline')} · {p.pending} {t('ui.offline.pending_moves','pending moves')}. {p.pending ? t('ui.offline.move_saved','Your move is saved on this device and will sync when connected.') : t('ui.offline.downloaded_play','Downloaded games are available on this device.')}</Notice>}
          {notificationBanner&&<Card style={{padding:14,borderColor:colors.accent}}><Copy style={{fontWeight:'700'}}>{notificationBanner.title}</Copy><Copy>{notificationBanner.body}</Copy><Row><Button compact onPress={()=>run(()=>openNotification(notificationBanner))}>{copyText('Open')}</Button><Button compact secondary onPress={()=>setNotificationBanner(null)}>{copyText('Dismiss')}</Button></Row></Card>}
          {appSession&&<Card><Title small>{copyText("Continue to the BuildPlay app")}</Title><Copy muted>{copyText("Confirm the account you want to use in the app. Your password stays out of the browser callback link.")}</Copy><Button onPress={()=>run(async()=>{if(!p.account){setAccount(true);return;}const result=await p.actions.request('POST',`/auth/app-sessions/${encodeURIComponent(appSession)}/complete`);await Linking.openURL(result.callback_url);setAppSession('');})}>{p.account?copyText("Continue as {v0}",{v0:p.account.display_name}):copyText("Log in to continue")}</Button></Card>}
          {pendingInvite&&<Card><Title small>{invitePreview?.created_by_display_name?copyText("{v0} invited you to play",{v0:invitePreview.created_by_display_name}):copyText("You’re invited to play")}</Title><Copy muted>{p.account?copyText("Join the match with your current account."):copyText("Log in or continue as a guest, then join this match.")}</Copy><Row><Button onPress={()=>run(async()=>{if(!p.account){setAccount(true);return;}const joined=await p.actions.acceptInvite(pendingInvite);setPendingInvite('');setInvitePreview(null);setScreen('matches');writeRoute(`match=${encodeURIComponent(joined.id)}`);})}>{p.account?copyText("Join match"):copyText("Log in to join")}</Button><Button secondary onPress={()=>{setPendingInvite('');setInvitePreview(null);writeRoute('games');}}>{copyText("Not now")}</Button></Row></Card>}
          {!p.ready ? <View style={s.loading}><ActivityIndicator size="large" color={colors.accent}/><Copy muted>{copyText("Loading BuildPlay…")}</Copy></View>
            : gameVisible ? <MatchStage />
            : screen==='games' ? p.selectedGameId ? <GameDetail /> : <Catalog />
            : screen==='matches' ? <Matches />
            : screen==='local' ? <LocalMatches />
            : screen==='invites' ? <Invitations />
            : <Settings layout={layout} setLayout={next=>{setLayout(next); void AsyncStorage.setItem('buildplay.navigation.v2',next);}} />}
          {!focus&&<Row style={s.footer}><Copy small muted>BuildPlay</Copy><Button secondary compact onPress={()=>navigate('settings')}>{t('ui.preferences.title','Preferences')}</Button><Button secondary compact onPress={()=>setPrivacy(true)}>{t('ui.privacy.title','Privacy')}</Button><Copy small muted>{p.network ? copyText("● Online") : copyText("○ Offline")}</Copy></Row>}
        </ScrollView>
      </View>
      <AccountDialog visible={account} onClose={()=>setAccount(false)} />
      <PrivacyDialog visible={privacy} onClose={()=>setPrivacy(false)} />
      <NotificationInbox visible={inbox} onClose={()=>setInbox(false)} onOpen={openNotification}/>
      <NotificationPrompt/>
      {gameVisible&&focus&&<View style={{position:'absolute',right:8,top:insets.top+2,zIndex:100}}><Button secondary compact onPress={toggleFocus}>{copyText('Exit focus mode')}</Button></View>}
    </SafeAreaView>
  </Context.Provider>;
}
export default function App() {
  const p=usePortal();
  const embedded=Platform.OS==='web'?document.getElementById('declarative-spec'):null;
  return <SafeAreaProvider><ErrorBoundary>{embedded?<EmbeddedGameHost spec={JSON.parse(embedded.textContent||'null')}/>:<PortalApp p={p}/>}</ErrorBoundary><BugReporter key={JSON.stringify([p.baseUrl,p.account?.id??'visitor'])} p={p} screen={p.selectedMatch?'match':p.selectedGameId?'game':'portal'}/><BugButton/></SafeAreaProvider>;
}
const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},
  mobileTabs:{maxHeight:58,flexGrow:0,backgroundColor:colors.surface}, sidebar:{width:230,backgroundColor:colors.surface,padding:18,gap:12,borderRightWidth:1,borderColor:colors.border},
  content:{width:'100%',maxWidth:1240,alignSelf:'center',gap:22,flexGrow:1},loading:{minHeight:300,alignItems:'center',justifyContent:'center',gap:20},footer:{marginTop:28,paddingTop:22,paddingBottom:20,borderTopWidth:1,borderColor:colors.border,justifyContent:'center'},
});
