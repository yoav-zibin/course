import React,{type ReactNode,useId,useState} from 'react';
import {Image,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import Svg,{Circle,Path} from 'react-native-svg';
import type {Account} from '../core/types';
import {recordDiagnosticEvent} from '../core/diagnostics';
import {copyText} from '../platform/i18n';
import {colors} from './components';

function HeaderGlyph({kind}:{kind:'bell'|'account'|'focus'}){
  return <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {kind==='bell'?<><Path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>:kind==='account'?<><Circle cx={12} cy={8} r={4}/><Path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>:<Path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>}
  </Svg>;
}

function HeaderButton({label,hint,disabled,onPress,children,testID}:{label:string;hint?:string;disabled?:boolean;onPress:()=>void;children:ReactNode;testID:string}){
  const description=useId();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} {...(Platform.OS==='web'&&hint?{'aria-describedby':description}:{})} accessibilityState={{disabled:Boolean(disabled)}} disabled={disabled} testID={testID}
    onPress={()=>{recordDiagnosticEvent('press',{label});onPress();}}
    style={({pressed,focused}:any)=>[s.button,disabled&&{opacity:.5},pressed&&{opacity:.8},focused&&{outlineColor:colors.blue,outlineStyle:'solid',outlineWidth:2}]}>{children}{Platform.OS==='web'&&hint&&<Text nativeID={description} style={s.description}>{hint}</Text>}</Pressable>;
}

function Avatar({uri}:{uri?:string}){
  const [failed,setFailed]=useState<string>();
  return uri&&failed!==uri?<Image source={{uri}} onError={()=>setFailed(uri)} accessible={false} style={s.avatar}/>:<HeaderGlyph kind="account"/>;
}

function amount(value:number,locale:string,compact=false){
  try{return new Intl.NumberFormat(locale,compact?{notation:'compact',maximumFractionDigits:1}:{}).format(value);}
  catch{return String(value);}
}

export function PortalHeader({width,locale,baseUrl,account,balance,unread,ready,gameVisible,navigation,onHome,onAccount,onNotifications,onFocus}:{
  width:number;locale:string;baseUrl:string;account:Account|null;balance:number;unread:number;ready:boolean;gameVisible:boolean;navigation?:ReactNode;
  onHome:()=>void;onAccount:()=>void;onNotifications:()=>void;onFocus:()=>void;
}){
  const narrow=width<380,compact=width<600&&Math.abs(balance)>=1000,exactBalance=amount(balance,locale);
  // Short K/M/B/T units keep balances readable in locales whose compact
  // notation uses whole words. The accessible value remains exact/localized.
  const visibleBalance=amount(balance,compact?'en':locale,compact);
  let avatar:string|undefined;
  try{if(account?.picture_url)avatar=new URL(account.picture_url,baseUrl).href;}catch{/* A malformed or unavailable picture uses the profile icon. */}
  return <View testID="portal-header" style={[s.header,narrow&&s.narrow]}>
    <Pressable accessibilityRole="link" accessibilityLabel={copyText('BuildPlay home')} onPress={onHome} style={s.home}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[s.brand,narrow&&s.smallBrand]}>BuildPlay<Text style={{color:colors.accent}}>●</Text></Text>
    </Pressable>
    {navigation&&<View style={s.navigation}>{navigation}</View>}
    <View style={s.spacer}/>
    {account&&<Text testID="header-token-balance" accessibilityLabel={`${exactBalance} ${copyText('tokens')}`} numberOfLines={1} style={[s.balance,narrow&&s.smallBalance]}>{visibleBalance} ✦</Text>}
    {account&&<HeaderButton label={copyText('Notifications')} hint={unread>0?copyText('Unread notifications: {v0}',{v0:amount(unread,locale)}):undefined} testID="header-notifications" onPress={onNotifications}>
      <HeaderGlyph kind="bell"/>
      {unread>0&&<View pointerEvents="none" style={s.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={s.badgeText}>{unread>99?'99+':amount(unread,locale)}</Text></View>}
    </HeaderButton>}
    {gameVisible&&<HeaderButton label={copyText('Focus mode')} testID="header-focus" onPress={onFocus}><HeaderGlyph kind="focus"/></HeaderButton>}
    <HeaderButton label={account?copyText('Account menu'):copyText('Log in')} hint={account?.display_name} disabled={!ready} testID="header-account" onPress={onAccount}><Avatar uri={avatar}/></HeaderButton>
  </View>;
}

const s=StyleSheet.create({
  header:{minHeight:74,paddingLeft:50,paddingRight:12,paddingVertical:12,borderBottomWidth:1,borderColor:colors.border,backgroundColor:colors.surface,flexDirection:'row',alignItems:'center',gap:6,flexWrap:'nowrap'},
  narrow:{gap:3,paddingRight:8},home:{flexShrink:0},brand:{fontSize:25,fontWeight:'800',letterSpacing:-1,color:colors.text,direction:'ltr'},smallBrand:{fontSize:17},
  navigation:{flexShrink:1,minWidth:0,marginHorizontal:10},spacer:{flex:1,minWidth:0},balance:{color:colors.accent,fontSize:13,flexShrink:1,direction:'ltr'},smallBalance:{fontSize:11,maxWidth:54},
  button:{width:40,height:40,flexShrink:0,borderRadius:8,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
  avatar:{width:30,height:30,borderRadius:15},badge:{position:'absolute',right:-3,top:-4,minWidth:15,height:15,borderRadius:8,paddingHorizontal:3,alignItems:'center',justifyContent:'center',backgroundColor:colors.accent},badgeText:{fontSize:9,lineHeight:13,fontWeight:'800',color:colors.ink},
  description:{position:'absolute',width:1,height:1,overflow:'hidden',opacity:0},
});
