import React,{useEffect,useId,useRef,useState} from 'react';
import {Platform,Pressable,ScrollView,View} from 'react-native';
import type {Game} from '../core/types';
import {gameSearchWords,gameSuggestionMatches} from '../core/game-search';
import {copyText} from '../platform/i18n';
import {Copy,Field,Notice,colors} from './components';
import {text,useApp} from './context';

export function GameSearch(){
  const {p,run,openGame}=useApp();
  const [query,setQuery]=useState(''),[expanded,setExpanded]=useState(false),[active,setActive]=useState(-1);
  const [response,setResponse]=useState<{query:string;scope:string;games:Game[];loading:boolean;error:string|null}>({query:'',scope:'',games:[],loading:false,error:null});
  const root=useRef<React.ComponentRef<typeof View>>(null),pressing=useRef(false),blurTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const listId=`game-suggestions-${useId()}`,scope=JSON.stringify([p.baseUrl,p.account?.id,p.locale]);
  const current=response.query===query&&response.scope===scope;
  const suggestions=gameSuggestionMatches([...p.recentGames,...p.popularGames,...Object.values(p.categoryGames).flat(),...p.games,...p.savedGames,...(current?response.games:[])],query);
  const visible=expanded&&gameSearchWords(query).length>0;
  useEffect(()=>{
    let alive=true;
    if(!visible)return;
    setResponse({query,scope,games:[],loading:true,error:null});
    const timer=setTimeout(()=>{
      void p.actions.suggestGames(query).then(games=>{if(alive)setResponse({query,scope,games,loading:false,error:null});},error=>{
        if(alive)setResponse({query,scope,games:[],loading:false,error:error instanceof Error?error.message:copyText('Search is unavailable. Try again.')});
      });
    },200);
    return()=>{alive=false;clearTimeout(timer);};
  },[query,scope,visible]);
  useEffect(()=>()=>{if(blurTimer.current)clearTimeout(blurTimer.current);},[]);
  const closeWhenOutside=()=>{
    if(blurTimer.current)clearTimeout(blurTimer.current);
    blurTimer.current=setTimeout(()=>{
      if(pressing.current)return;
      if(Platform.OS==='web'&&typeof document!=='undefined'&&(root.current as unknown as HTMLElement)?.contains(document.activeElement))return;
      setExpanded(false);setActive(-1);
    },Platform.OS==='web'?0:150);
  };
  const choose=({game}:{game:Game})=>{setExpanded(false);setActive(-1);void run(()=>openGame(game.id));};
  return <View ref={root} testID="game-search" style={{gap:8}}>
    <Field label={text(p,'ui.games.search','Search games')} placeholder={text(p,'ui.games.search_placeholder','Find a game…')} value={query}
      accessibilityRole="combobox" accessibilityState={{expanded:visible}} autoCapitalize="none" autoCorrect={false} maxLength={120} returnKeyType="search" blurOnSubmit={false}
      {...(Platform.OS==='web'?{'aria-autocomplete':'list' as const,'aria-expanded':visible,'aria-controls':visible?listId:undefined,'aria-activedescendant':visible&&active>=0&&suggestions[active]?`${listId}-${suggestions[active].game.id}`:undefined}:{})}
      onFocus={()=>setExpanded(true)} onBlur={closeWhenOutside}
      onChangeText={value=>{setQuery(value);setExpanded(true);setActive(-1);}}
      onKeyPress={event=>{
        const key=event.nativeEvent.key;
        if(key==='Escape'){event.preventDefault();setExpanded(false);setActive(-1);}
        else if(key==='ArrowDown'||key==='ArrowUp'){
          event.preventDefault();setExpanded(true);setActive(index=>suggestions.length?(key==='ArrowDown'?Math.min(index+1,suggestions.length-1):index<=0?suggestions.length-1:index-1):-1);
        }else if(key==='Enter'&&visible&&suggestions.length){event.preventDefault();choose(suggestions[Math.max(0,active)]||suggestions[0]);}
      }}
      onSubmitEditing={()=>{if(visible&&suggestions.length)choose(suggestions[Math.max(0,active)]||suggestions[0]);}}/>
    {visible&&<View style={{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:8,overflow:'hidden'}}>
      <ScrollView nativeID={listId} accessibilityRole={Platform.OS==='web'?'listbox':'list'} accessibilityLabel={copyText('Game suggestions')} keyboardShouldPersistTaps="handled" style={{maxHeight:330}}>
        {suggestions.map((match,index)=>{
          const {game,alternativeName}=match;
          const label=alternativeName?`${game.name} (${alternativeName})`:game.name;
          return <Pressable key={game.id} nativeID={`${listId}-${game.id}`} accessibilityRole={Platform.OS==='web'?'option':'button'} accessibilityLabel={label} accessibilityState={{selected:active===index}}
          {...(Platform.OS==='web'?{tabIndex:-1,'aria-selected':active===index}:{})} onPressIn={()=>{pressing.current=true;}} onPressOut={()=>{pressing.current=false;}} onBlur={closeWhenOutside}
          onPress={()=>choose(match)} style={({pressed})=>({paddingHorizontal:14,paddingVertical:13,minHeight:48,backgroundColor:active===index||pressed?colors.raised:colors.surface,borderBottomWidth:index<suggestions.length-1?1:0,borderBottomColor:colors.border})}>
            <Copy>{label}</Copy>
          </Pressable>;
        })}
      </ScrollView>
      <View accessibilityLiveRegion="polite" style={{paddingHorizontal:14,paddingVertical:8}}>
        {current&&response.error?<Notice error>{response.error}</Notice>:current&&response.loading?<Copy small muted>{text(p,'ui.action.loading','Loading games…')}</Copy>:!suggestions.length?<Copy small muted>{text(p,'ui.games.empty','No games found. Try another search.')}</Copy>:null}
      </View>
    </View>}
  </View>;
}
