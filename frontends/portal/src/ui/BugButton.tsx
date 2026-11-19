import React,{useEffect,useMemo,useRef} from 'react';
import {PanResponder,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {bugButtonLabel,openBugReport} from './bugControl';
import {BUG_HEIGHT,BUG_WIDTH,bugBounds,isBugDrag,normalizedBugPoint,resolveBugPoint,setBugPosition,useBugPosition} from './bugPosition';
import {recordDiagnosticEvent} from '../core/diagnostics';
export function BugButton(){
  const insets=useSafeAreaInsets(),{width,height}=useWindowDimensions(),saved=useBugPosition();
  const bounds=bugBounds(width,height,insets),point=resolveBugPoint(saved,bounds);
  const current=useRef({bounds,point});current.current={bounds,point};
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
  return <View {...responder.panHandlers} style={[styles.position,{left:point.x,top:point.y}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={bugButtonLabel()} onPressIn={()=>{dragged.current=false;}}
      onPress={()=>{if(!dragged.current)openBugReport();}} style={styles.bug} testID="bug-report-button"><BugGlyph/></Pressable>
  </View>;
}
const styles=StyleSheet.create({position:{position:'absolute',width:BUG_WIDTH,height:BUG_HEIGHT,zIndex:2147483647,elevation:100},
  bug:{width:BUG_WIDTH,height:BUG_HEIGHT,alignItems:'center',justifyContent:'center',backgroundColor:'#171c2a',borderWidth:1,borderColor:'#3b4760',borderRadius:8}});
