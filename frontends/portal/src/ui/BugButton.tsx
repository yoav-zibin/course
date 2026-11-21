import React,{useEffect,useMemo,useRef} from 'react';
import {findNodeHandle,PanResponder,Platform,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {MenuGlyph} from './MenuGlyph';
import {copyText} from '../platform/i18n';
import {bugButtonLabel,openBugReport} from './bugControl';
import {BUG_HEIGHT,BUG_WIDTH,MATCH_CONTROLS_HEIGHT,MATCH_CONTROLS_WIDTH,bugBounds,isBugDrag,normalizedBugPoint,resolveBugPoint,setBugPosition,useBugPosition} from './bugPosition';
import {recordDiagnosticEvent,recordDiagnosticLog} from '../core/diagnostics';
import {protectBugControlGesture} from '../platform/legacy';
import {createBugGestureProtection} from './bugGestureProtection';
export function BugButton({onMenuPress,menuExpanded=false}:{onMenuPress?:()=>void;menuExpanded?:boolean}={}){
  const insets=useSafeAreaInsets(),{width,height}=useWindowDimensions(),saved=useBugPosition();
  const grouped=Boolean(onMenuPress),controlWidth=grouped?MATCH_CONTROLS_WIDTH:BUG_WIDTH,controlHeight=grouped?MATCH_CONTROLS_HEIGHT:BUG_HEIGHT;
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
  const buttonStyle=({pressed,focused}:any)=>[styles.button,{height:controlHeight-2},pressed&&{opacity:.7},focused&&{outlineColor:'#70d5ff',outlineStyle:'solid',outlineWidth:2}];
  return <View ref={nativeView} collapsable={false} onLayout={protectGesture} {...responder.panHandlers} testID={grouped?'match-floating-controls':undefined} style={[styles.position,{left:point.x,top:point.y,width:controlWidth,height:controlHeight}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={bugButtonLabel()} onPressIn={()=>{dragged.current=false;}}
      onPress={()=>{if(!dragged.current)openBugReport();}} style={buttonStyle} testID="bug-report-button"><BugGlyph/></Pressable>
    {onMenuPress&&<Pressable accessibilityRole="button" accessibilityLabel={copyText('Match menu')} accessibilityState={{expanded:menuExpanded}} onPressIn={()=>{dragged.current=false;}}
      onPress={()=>{if(!dragged.current)onMenuPress();}} style={buttonStyle} testID="match-menu-button"><MenuGlyph/></Pressable>}
  </View>;
}
const styles=StyleSheet.create({position:{position:'absolute',flexDirection:'row',backgroundColor:'#171c2a',borderWidth:1,borderColor:'#3b4760',borderRadius:8,zIndex:2147483647,elevation:100},
  button:{flex:1,minWidth:0,alignItems:'center',justifyContent:'center',borderRadius:7}});
