import {AccountScopeChangedError,visibleErrorMessage} from './core/account-scope';
import {copyText} from './platform/i18n';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, BackHandler, Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {usePortal} from './core';
import {Button, Card, Copy, Notice, Row, Title, colors} from './ui/components';
import {Context, Screen, text} from './ui/context';
import {Catalog, GameDetail, Matches, LocalMatches} from './ui/screens';
import {AccountDialog} from './ui/AccountDialog';
import {AccountDeletionBanner} from './ui/AccountDeletion';
import {MatchStage} from './ui/MatchStage';
import {BugReporter} from './ui/BugReporter';
import {BugButton} from './ui/BugButton';
import {MATCH_HISTORY_HEIGHT} from './ui/bugPosition';
import {diagnosticPath,recordDiagnosticPage,recordDiagnosticEvent,rememberDiagnosticSecrets} from './core/diagnostics';
import {installWebApp} from './ui/webApp';
import {EmbeddedGameHost} from './game/EmbeddedGameHost';
import {getDirection} from './platform/i18n';
import {configureReporter,createReporter,reportClientIssue} from './core/reporting';
import {ErrorBoundary} from './ui/ErrorBoundary';
import {readLocalUiTest} from './platform/legacy';
import {notificationTarget} from './core/notifications';
import {playerLink} from './core/links';
import type {InAppNotification} from './core/types';
import {useNotificationDelivery} from './ui/useNotificationDelivery';
import {NotificationInbox, NotificationItem, NotificationPrompt} from './ui/Notifications';
import {PortalHeader} from './ui/PortalHeader';
import {useMatchHistory,type MatchHistoryController} from './ui/matchHistory';

function PortalApp({p,boardVisible,matchMenuOpen,onCloseMatchMenu,history}: {p:ReturnType<typeof usePortal>;boardVisible:boolean;matchMenuOpen:boolean;onCloseMatchMenu:()=>void;history:MatchHistoryController}) {
  const {width} = useWindowDimensions();
  const fittedBoard=boardVisible&&!p.selectedMatch?.awaitingHandoff;
  const localOnly=useRef(readLocalUiTest()).current;
  const [screen, setScreen] = useState<Screen>('games');
  const [account, setAccount] = useState(false);
  const [menuDestination,setMenuDestination]=useState<'account'|'inbox'|null>(null);
  const content = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [notice, setNotice] = useState('');
  const [inbox,setInbox] = useState(false), [notificationBanner,setNotificationBanner] = useState<InAppNotification|null>(null);
  const observedNotifications = useRef<{scope:string; ids:Set<string>; initialized:boolean}>({scope:'',ids:new Set(),initialized:false});
  const [appSession,setAppSession] = useState('');
  const [pendingInvite,setPendingInvite]=useState(''),[invitePreview,setInvitePreview]=useState<any>(null);
  const navigation = useRef(0), acceptingInvite = useRef('');
  const knownPasswords=useRef(new Set<string>());
  const reportingAccount=useRef(p.account);reportingAccount.current=p.account;
  const reportingContext=useRef<Record<string,unknown>>({});
  reportingContext.current={platform:Platform.OS,locale:p.locale,screen,gameId:p.selectedGameId,
    gameVersion:p.game?.version,matchId:p.selectedMatch?.id,network:p.network};
  const notificationScope = useRef(''); notificationScope.current = JSON.stringify([p.baseUrl,p.account?.id]);
  for(const saved of p.accounts)knownPasswords.current.add(saved.password);
  rememberDiagnosticSecrets(knownPasswords.current);
  useEffect(()=>recordDiagnosticPage({screen,gameId:p.selectedGameId,matchId:p.selectedMatch?.id,matchMenuOpen}),[screen,p.selectedGameId,p.selectedMatch?.id,matchMenuOpen]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>content.current?.scrollTo({x:0,y:0,animated:false}));return()=>cancelAnimationFrame(frame);},[fittedBoard]);
  const t = (key: string, fallback: string) => text(p,key,fallback);
  const run = useCallback(async (task: () => Promise<unknown>) => {try { await task(); } catch (error) {const message=visibleErrorMessage(error);if(message!==null)setNotice(message);}}, []);
  const routeBase = Platform.OS === 'web' ? window.location.origin : process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun';
  const writeRoute = (fragment: string) => { if (Platform.OS === 'web') {const url = new URL(window.location.href); if(url.pathname==='/portal'&&!url.search&&url.hash.slice(1)===fragment)return; url.pathname = '/portal'; url.search = ''; url.hash = fragment; window.history.pushState(null, '', url);}};
  const clearInvite = () => {navigation.current++; acceptingInvite.current=''; setPendingInvite(''); setInvitePreview(null);};
  const navigate = (next: Screen) => {onCloseMatchMenu();history.stopPlayback();clearInvite();if(next==='games')p.actions.clearGame();else p.actions.clearMatch(); setScreen(next); writeRoute(next);};
  const openGame = async (id: string) => {clearInvite();setScreen('games');writeRoute(`game=${encodeURIComponent(id)}`);await p.actions.selectGame(id);};
  const openMatch = async (id: string) => {clearInvite();setScreen('matches');writeRoute(`match=${encodeURIComponent(id)}`);await p.actions.selectMatch(id);};
  const openInvite = async (token: string) => {
    const epoch=++navigation.current;acceptingInvite.current='';setPendingInvite('');setInvitePreview(null);setScreen('matches');
    const preview=await p.actions.openInvite(token);
    if(epoch!==navigation.current||!preview)return;
    setPendingInvite(token);setInvitePreview(preview);
  };
  const receiveLink = async (raw: string | null) => {
    if(!raw)return;
    await p.actions.rememberAttribution(raw);
    const target=playerLink(raw,routeBase);if(!target)return;
    if(target.kind==='app-login'){setAppSession(target.id);return;}
    if(target.kind==='invite')await openInvite(target.id);
    else if(target.kind==='match')await openMatch(target.id);
    else if(target.kind==='game')await openGame(target.id);
    else if(target.kind==='rematch'){const next=await p.actions.request('POST',`/matches/${encodeURIComponent(target.id)}/rematch`);await openMatch(next.id);}
    else if(target.kind==='screen') {clearInvite();p.actions.clearGame();setScreen(target.id);}
  };

  const openNotificationUrl = async (raw: string) => {
    const scope = notificationScope.current, guard = () => {if (scope !== notificationScope.current) throw new AccountScopeChangedError();};
    const target = notificationTarget(raw, p.baseUrl); if (!target) throw new Error(copyText('This notification link is unavailable.'));
    if (target.kind === 'invite') {await openInvite(target.id); guard();}
    else if (target.kind === 'rematch') {const next = await p.actions.request('POST', `/matches/${encodeURIComponent(target.id)}/rematch`); guard(); await openMatch(next.id);}
    else await openMatch(target.id);
  };
  const notificationDelivery = useNotificationDelivery(p, openNotificationUrl, setNotice, localOnly);
  const openNotification = async (item: InAppNotification) => {
    const scope=notificationScope.current;
    await openNotificationUrl(item.url);
    if(scope!==notificationScope.current)return;
    await p.actions.readNotification(item.id);
    if(scope!==notificationScope.current)return;
    setInbox(false); setNotificationBanner(current=>current?.id===item.id?null:current);
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
      finally {if (!stopped) timer = setTimeout(poll,inbox?2000:8000);}
    };
    void poll(); return () => {stopped = true; clearTimeout(timer);};
  }, [p.ready,p.baseUrl,p.account?.id,inbox]);
  useEffect(() => {
    const observed = observedNotifications.current;
    const fresh = p.notifications.find(item => !item.read_at && !observed.ids.has(item.id));
    if (observed.initialized && fresh) setNotificationBanner(fresh);
    else setNotificationBanner(current=>p.notifications.some(item=>item.id===current?.id)?current:null);
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
    if (Platform.OS === 'web') installWebApp();
    await receiveLink(initialUrl);
  });}, []);
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({url}) => {void run(()=>receiveLink(url));});
    const resume = AppState.addEventListener('change', state => {if (state === 'active') void run(() => p.actions.refresh());});
    const pop = () => {void run(()=>receiveLink(window.location.href));};
    if (Platform.OS === 'web') {window.addEventListener('popstate',pop);window.addEventListener('hashchange',pop);}
    return () => {subscription.remove(); resume.remove(); if (Platform.OS === 'web') {window.removeEventListener('popstate',pop);window.removeEventListener('hashchange',pop);}};
  }, []);
  useEffect(()=>{
    if(!p.ready||!p.account||!pendingInvite||!invitePreview)return;
    const key=JSON.stringify([p.baseUrl,p.account.id,pendingInvite]);
    if(acceptingInvite.current===key)return;
    acceptingInvite.current=key;
    const epoch=navigation.current;
    void run(async()=>{
      const match=await p.actions.acceptInvite(pendingInvite);
      if(epoch!==navigation.current||!match)return;
      setPendingInvite('');setInvitePreview(null);setScreen('matches');writeRoute(`match=${encodeURIComponent(match.id)}`);
    });
  },[p.ready,p.baseUrl,p.account?.id,pendingInvite,invitePreview]);
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
      if(matchMenuOpen){onCloseMatchMenu();return true;}
      if(p.selectedMatch){navigate('matches');return true;}
      if(p.selectedGameId){p.actions.clearGame();setScreen('games');return true;}
      if(screen!=='games'){navigate('games');return true;}
      return false;
    });return()=>listener.remove();
  },[account,screen,p.selectedMatch?.id,p.selectedGameId,matchMenuOpen]);
  useEffect(()=>{
    if(localOnly){
      configureReporter(()=>{});
      if(Platform.OS==='web')(window as any).SiteBugReporter?.claimPortal?.();
      return;
    }
    configureReporter(createReporter(p.baseUrl,()=>knownPasswords.current,fetch,{
      account:()=>reportingAccount.current,context:()=>reportingContext.current,
    }));
    if(Platform.OS==='web'){
      (window as any).SiteBugReporter?.claimPortal?.();
      document.documentElement.lang=p.locale;document.documentElement.dir=getDirection();
      const error=(event:ErrorEvent)=>reportClientIssue('script_error',event.error||`${event.message} (${diagnosticPath(event.filename||'')}:${event.lineno||0}:${event.colno||0})`);
      const rejection=(event:PromiseRejectionEvent)=>reportClientIssue('unhandled_rejection',event.reason);
      window.addEventListener('error',error);window.addEventListener('unhandledrejection',rejection);
      return()=>{window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',rejection);};
    }
    const errors=(globalThis as any).ErrorUtils,previous=errors?.getGlobalHandler?.();
    if(previous)errors.setGlobalHandler((error:Error,fatal:boolean)=>{reportClientIssue('script_error',error);previous(error,fatal);});
    return()=>{if(previous)errors.setGlobalHandler(previous);};
  },[p.baseUrl,p.locale,p.account?.id]);
  useEffect(()=>{if(p.storageError)reportClientIssue('storage_error',p.storageError);},[p.storageError]);

  const gameVisible = p.selectedMatch !== null;
  const showDetails = !boardVisible;
  // New destinations start at the top; updates within a match keep its position.
  const contentKey = gameVisible ? `match:${p.selectedMatch!.id}` : screen === 'games' && p.selectedGameId ? `game:${p.selectedGameId}` : screen;
  const openHeaderDialog=(destination:'account'|'inbox')=>{
    // iOS presents sibling modals after the current modal finishes dismissing.
    if(Platform.OS==='ios'&&matchMenuOpen){setMenuDestination(destination);onCloseMatchMenu();return;}
    onCloseMatchMenu();if(destination==='account')setAccount(true);else setInbox(true);
  };
  const menuDismissed=()=>{const destination=menuDestination;setMenuDestination(null);if(destination==='account')setAccount(true);else if(destination==='inbox')setInbox(true);};
  const header=<PortalHeader width={boardVisible?Math.min(width-80,700):width} insideDialog={boardVisible} locale={p.locale} baseUrl={p.baseUrl} account={p.account} balance={p.profile?.token_balance??p.account?.token_balance??0} unread={p.unreadNotifications} ready={p.ready}
        gamesLabel={t('ui.portal.nav_games','Games')} matchesLabel={t('ui.portal.nav_matches','Matches')} selected={screen==='games'?'games':'matches'}
        onGames={()=>navigate('games')} onMatches={()=>navigate('matches')} onAccount={()=>openHeaderDialog('account')} onNotifications={()=>openHeaderDialog('inbox')}/>;
  const extras=<>
    <AccountDeletionBanner/>
    {(!p.network || p.pending>0) && <Notice>{p.network ? t('ui.offline.online','Online') : t('ui.offline.offline','Offline')} · {p.pending} {copyText('pending saves')}. {p.pending ? copyText('Your progress is saved locally and will sync to the cloud when connected.') : copyText('Downloaded single-player games keep working offline; progress syncs when you reconnect.')}</Notice>}
          {notificationBanner&&!inbox&&<View style={{gap:10}}><NotificationItem item={notificationBanner} onOpen={openNotification}/>{!gameVisible&&<Button compact secondary onPress={()=>setNotificationBanner(null)}>{copyText('Dismiss')}</Button>}</View>}
          {appSession&&<Card><Title small>{copyText("Continue to the BuildPlay app")}</Title><Copy muted>{copyText("Confirm the account you want to use in the app. Your password stays out of the browser callback link.")}</Copy><Button onPress={()=>run(async()=>{if(!p.account){setAccount(true);return;}const result=await p.actions.request('POST',`/auth/app-sessions/${encodeURIComponent(appSession)}/complete`);await Linking.openURL(result.callback_url);setAppSession('');})}>{p.account?copyText("Continue as {v0}",{v0:p.account.display_name}):copyText("Log in to continue")}</Button></Card>}
    <NotificationPrompt inline={boardVisible}/>
  </>;
  return <Context.Provider value={{p,notificationDelivery,notify:setNotice,run,openAccount:()=>openHeaderDialog('account'),navigate,openGame,openMatch}}>
    <SafeAreaView style={[s.safe,{direction:getDirection()}]} edges={['top','bottom','left','right']}>
      <StatusBar style="light" />
      {showDetails&&header}
      <View style={{flex:1,flexDirection:'row',minHeight:0}}>
        <ScrollView ref={content} key={contentKey} style={{flex:1,minWidth:0}} scrollEnabled={!fittedBoard} contentContainerStyle={[s.content,gameVisible&&{maxWidth:1500},fittedBoard?s.fittedBoard:{padding:gameVisible?0:width<600?14:28}]} keyboardShouldPersistTaps="handled">
          {(notice || p.error) && <Notice error onDismiss={()=>{setNotice('');p.actions.clearError();}}>{notice || p.error}</Notice>}
          {p.storageError && <Notice error>{p.storageError}</Notice>}
          {showDetails&&extras}
          {pendingInvite&&!p.account&&invitePreview?.usable&&<Card><Title small>{copyText('You’re invited to play')}</Title><Copy muted>{copyText('Log in or continue as a guest to join this match.')}</Copy><Row><Button onPress={()=>setAccount(true)}>{copyText('Log in to join')}</Button><Button secondary onPress={()=>{p.actions.watchInvite();clearInvite();writeRoute(`match=${encodeURIComponent(invitePreview.match.id)}`);}}>{copyText('Watch match')}</Button></Row></Card>}
          {!p.ready ? <View style={s.loading}><ActivityIndicator size="large" color={colors.accent}/><Copy muted>{copyText("Loading BuildPlay…")}</Copy></View>
            : gameVisible ? <MatchStage menuOpen={matchMenuOpen} onCloseMenu={onCloseMatchMenu} menuHeader={header} menuExtras={extras} history={history} onMenuDismissed={menuDismissed}/>
            : screen==='games' ? p.selectedGameId ? <GameDetail /> : <Catalog />
            : screen==='matches' ? <Matches />
            : <LocalMatches />}
        </ScrollView>
      </View>
      <AccountDialog visible={account} onClose={()=>setAccount(false)} />
      <NotificationInbox visible={inbox} onClose={()=>setInbox(false)} onOpen={openNotification}/>
    </SafeAreaView>
  </Context.Provider>;
}
export default function App() {
  const p=usePortal();
  const history=useMatchHistory(p);
  const [menuMatch,setMenuMatch]=useState<string|null>(null);
  const boardVisible=Boolean(p.selectedMatch&&p.selectedMatch.status!=='waiting_for_players');
  const matchKey=JSON.stringify([p.baseUrl,p.account?.id,p.selectedMatch?.id]);
  const matchMenuOpen=boardVisible&&menuMatch===matchKey;
  useEffect(()=>{setMenuMatch(null);},[p.baseUrl,p.account?.id,p.selectedMatch?.id]);
  const toggleMatchMenu=()=>{if(!matchMenuOpen)history.stopPlayback();setMenuMatch(matchMenuOpen?null:matchKey);recordDiagnosticEvent('match_menu',{expanded:!matchMenuOpen});};
  const embedded=Platform.OS==='web'?document.getElementById('declarative-spec'):null;
  return <SafeAreaProvider><ErrorBoundary>{embedded?<EmbeddedGameHost spec={JSON.parse(embedded.textContent||'null')}/>:<PortalApp p={p} boardVisible={boardVisible} matchMenuOpen={matchMenuOpen} onCloseMatchMenu={()=>setMenuMatch(null)} history={history}/>}</ErrorBoundary><BugReporter key={JSON.stringify([p.baseUrl,p.account?.id??'visitor'])} p={p} screen={p.selectedMatch?'match':p.selectedGameId?'game':'portal'}/><BugButton onMenuPress={boardVisible&&!embedded?toggleMatchMenu:undefined} menuExpanded={matchMenuOpen} history={boardVisible&&!embedded?{...history.controls,disabled:history.controls.disabled||matchMenuOpen}:undefined}/></SafeAreaProvider>;
}
const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},
  fittedBoard:{height:'100%',maxWidth:'100%',gap:0,paddingBottom:MATCH_HISTORY_HEIGHT+2},
  content:{width:'100%',maxWidth:1240,alignSelf:'center',gap:22,flexGrow:1},loading:{minHeight:300,alignItems:'center',justifyContent:'center',gap:20},
});
