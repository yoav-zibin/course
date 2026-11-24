import React,{useEffect,useMemo,useRef} from 'react';
import {findNodeHandle,PanResponder,Platform,Pressable,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {MenuGlyph} from './MenuGlyph';
import {HistoryGlyph,historyButtons} from './HistoryGlyph';
import type {MatchHistoryControls} from './matchHistory';
import {copyText} from '../platform/i18n';
import {bugButtonLabel,openBugReport} from './bugControl';
import {BUG_HEIGHT,BUG_WIDTH,bugBounds,isBugDrag,matchControlsSize,normalizedBugPoint,resolveBugPoint,setBugPosition,useBugPosition} from './bugPosition';
import {recordDiagnosticEvent,recordDiagnosticLog} from '../core/diagnostics';
import {protectBugControlGesture} from '../platform/legacy';
import {createBugGestureProtection} from './bugGestureProtection';
export function BugButton({onMenuPress,menuExpanded=false,history}:{onMenuPress?:()=>void;menuExpanded?:boolean;history?:MatchHistoryControls}={}){
  const insets=useSafeAreaInsets(),{width,height}=useWindowDimensions(),saved=useBugPosition();
  const grouped=Boolean(onMenuPress),size=grouped?matchControlsSize(width,insets,Boolean(history)):{width:BUG_WIDTH,height:BUG_HEIGHT},controlWidth=size.width,controlHeight=size.height;
  const bounds=bugBounds(width,height,insets,undefined,{width:controlWidth,height:controlHeight}),point=resolveBugPoint(saved??(grouped?{x:1,y:1}:null),bounds);
  const current=useRef({bounds,point});current.current={bounds,point};
  const nativeView=useRef<React.ComponentRef<typeof View>>(null);
  const protectionReported=useRef<boolean|undefined>(undefined);
  const protection=useRef<ReturnType<typeof createBugGestureProtection>|null>(null);
  useEffect(()=>{
    if(Platform.OS!=='android'||Number(Platform.Version)<29)return;
    const registration=createBugGestureProtection({
      getTag:()=>findNodeHandle(nativeView.current)??null,protect:protectBugControlGesture,
      afterFrame:callback=>{const id=requestAnimationFrame(callback);return()=>cancelAnimationFrame(id);},
      later:callback=>{const id=setTimeout(callback,50);return()=>clearTimeout(id);},
      onResult:result=>{
        if(protectionReported.current===result.protected)return;
        protectionReported.current=result.protected;
        if(result.protected)recordDiagnosticEvent('bug_control_gesture_protected',{attempts:result.attempts});
        else recordDiagnosticLog('warn','bug_gesture_exclusion',result);
      },
    });
    protection.current=registration;
    registration.register();
    return()=>{registration.dispose();protection.current=null;};
  },[]);
  const protectGesture=()=>protection.current?.register();
  const start=useRef(point),dragged=useRef(false),releaseTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const responder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponderCapture:(_,gesture)=>isBugDrag(gesture.dx,gesture.dy),
    onPanResponderGrant:()=>{start.current=current.current.point;dragged.current=true;},
    onPanResponderMove:(_,gesture)=>setBugPosition(normalizedBugPoint({x:start.current.x+gesture.dx,y:start.current.y+gesture.dy},current.current.bounds)),
    onPanResponderRelease:()=>{
      recordDiagnosticEvent('bug_control_moved',{x:Math.round(current.current.point.x),y:Math.round(current.current.point.y)});
      // The child press was cancelled when the drag responder took over. Keep
      // this guard through release, then allow later accessibility activation.
      releaseTimer.current=setTimeout(()=>{dragged.current=false;},0);
    },
    onPanResponderTerminate:()=>{dragged.current=false;},
    onPanResponderTerminationRequest:()=>false,
    onShouldBlockNativeResponder:()=>true,
  }),[]);
  useEffect(()=>()=>clearTimeout(releaseTimer.current),[]);
  const buttonStyle=({pressed,focused}:any)=>[styles.button,{height:(grouped&&history?44:controlHeight)-2},pressed&&{opacity:.7},focused&&{outlineColor:'#70d5ff',outlineStyle:'solid',outlineWidth:2}];
  return <View ref={nativeView} collapsable={false} onLayout={protectGesture} {...responder.panHandlers} testID={grouped?'match-floating-controls':undefined} style={[styles.position,{left:point.x,top:point.y,width:controlWidth,height:controlHeight}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={bugButtonLabel()} onPressIn={()=>{dragged.current=false;}}
      onPress={()=>{if(!dragged.current)openBugReport();}} style={buttonStyle} testID="bug-report-button"><BugGlyph/></Pressable>
    {onMenuPress&&<Pressable accessibilityRole="button" accessibilityLabel={copyText('Match menu')} accessibilityState={{expanded:menuExpanded}} onPressIn={()=>{dragged.current=false;}}
      onPress={()=>{if(!dragged.current)onMenuPress();}} style={buttonStyle} testID="match-menu-button"><MenuGlyph/></Pressable>}
    {grouped&&history&&historyButtons(history).map(control=><Pressable key={control.id} accessibilityRole="button" accessibilityLabel={control.label} accessibilityState={{disabled:control.disabled}} disabled={control.disabled} onPressIn={()=>{dragged.current=false;}}
      onPress={()=>{if(!dragged.current&&!control.disabled){recordDiagnosticEvent('press',{label:control.label});control.onPress();}}} style={state=>[buttonStyle(state),control.disabled&&styles.disabled]} testID={control.id}><HistoryGlyph kind={control.kind}/></Pressable>)}
    {grouped&&history&&<Text testID="history-status" pointerEvents="none" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.historyStatus}>{history.atEnd?copyText('Live board'):copyText('Replay · move {v0} of {v1}',{v0:history.position,v1:history.total})}</Text>}
  </View>;
}
const styles=StyleSheet.create({position:{position:'absolute',flexDirection:'row',direction:'ltr',backgroundColor:'#171c2a',borderWidth:1,borderColor:'#3b4760',borderRadius:8,zIndex:2147483647,elevation:100},
  button:{flex:1,minWidth:0,alignItems:'center',justifyContent:'center',borderRadius:7},disabled:{opacity:.35},
  historyStatus:{position:'absolute',left:4,right:4,bottom:2,height:17,fontSize:11,lineHeight:16,textAlign:'center',color:'#b8c2d5'}});
