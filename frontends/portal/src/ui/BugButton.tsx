import React,{useCallback,useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {findNodeHandle,Platform,Pressable,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {Gesture,GestureDetector} from 'react-native-gesture-handler';
import Animated,{useAnimatedStyle,useSharedValue,withDelay,withTiming} from 'react-native-reanimated';
import {scheduleOnRN,scheduleOnUI} from 'react-native-worklets';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {MenuGlyph} from './MenuGlyph';
import {HistoryGlyph,historyButtons} from './HistoryGlyph';
import type {MatchHistoryControls} from './matchHistory';
import {copyText} from '../platform/i18n';
import {bugButtonLabel,openBugReport} from './bugControl';
import {BUG_HEIGHT,BUG_WIDTH,bugBounds,matchControlsSize,normalizedBugPoint,resolveBugPoint,setBugPosition,useBugPosition,type BugBounds,type BugPoint} from './bugPosition';
import {recordDiagnosticEvent,recordDiagnosticLog} from '../core/diagnostics';
import {protectBugControlGesture} from '../platform/legacy';
import {createBugGestureProtection} from './bugGestureProtection';
export function BugButton({onMenuPress,menuExpanded=false,history}:{onMenuPress?:()=>void;menuExpanded?:boolean;history?:MatchHistoryControls}={}){
  const insets=useSafeAreaInsets(),{width,height}=useWindowDimensions(),saved=useBugPosition();
  const grouped=Boolean(onMenuPress),size=grouped?matchControlsSize(width,insets,Boolean(history)):{width:BUG_WIDTH,height:BUG_HEIGHT},controlWidth=size.width,controlHeight=size.height;
  const bounds=bugBounds(width,height,insets,undefined,{width:controlWidth,height:controlHeight}),point=resolveBugPoint(saved??(grouped?{x:1,y:1}:null),bounds);
  const translation=useSharedValue(point);
  const limits=useSharedValue(bounds);
  const origin=useSharedValue(point);
  const dragging=useSharedValue(false);
  const buttons=grouped&&history?historyButtons(history):[];
  const slots=grouped?2+buttons.length:1,slotWidth=(controlWidth-2)/slots;
  const buttonHeight=(grouped&&history?44:controlHeight)-2;
  const disabledSlots=buttons.reduce((mask,button,i)=>button.disabled?mask|(1<<(i+2)):mask,0);
  const pressedSlot=useSharedValue(0),pressedOpacity=useSharedValue(0);
  const pressedStyle=useAnimatedStyle(()=>({opacity:pressedOpacity.value,transform:[{translateX:pressedSlot.value*slotWidth}]}));
  const timing=useSharedValue({start:0,last:0,inputs:0,maxGap:0,slowGaps:0});
  useLayoutEffect(()=>{
    scheduleOnUI((nextBounds:BugBounds,nextPoint:BugPoint)=>{
      'worklet';
      limits.value=nextBounds;
      if(!dragging.value)translation.value=nextPoint;
    },bounds,point);
  },[bounds.left,bounds.top,bounds.right,bounds.bottom,point.x,point.y,dragging,limits,translation]);
  const style=useAnimatedStyle(()=>({
    transform:[{translateX:translation.value.x},{translateY:translation.value.y}],
  }));
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
  const commitDrag=useCallback((placed:BugPoint,endBounds:BugBounds,trace:{start:number;inputs:number;maxGap:number;slowGaps:number},
                   endedAt:number,canceled:boolean)=>{
    setBugPosition(normalizedBugPoint(placed,endBounds));
    recordDiagnosticEvent('drag_performance',{
      surface:'floating_controls',execution:'native_ui',outcome:canceled?'cancelled':'released',
      input_events:trace.inputs,duration_ms:endedAt-trace.start,max_ui_update_gap_ms:trace.maxGap,
      ui_gaps_over_34ms:trace.slowGaps,js_release_delay_ms:Math.max(0,Date.now()-endedAt),
    });
    if(!canceled)recordDiagnosticEvent('bug_control_moved',{x:Math.round(placed.x),y:Math.round(placed.y)});
  },[]);
  const move=useCallback((x:number,y:number)=>{
    'worklet';
    const box=limits.value;
    translation.value={
      x:Math.max(box.left,Math.min(box.right,origin.value.x+x)),
      y:Math.max(box.top,Math.min(box.bottom,origin.value.y+y)),
    };
  },[limits,origin,translation]);
  // The direct detector attaches to the transformed control itself. A separate
  // layout-less detector host gives Android accessibility a zero-height parent.
  const pan=useMemo(()=>Gesture.Pan().minDistance(5).maxPointers(1)
    .runOnJS(false).cancelsTouchesInView(true)
    .onTouchesDown(event=>{
      'worklet';
      const touch=event.changedTouches[0];if(!touch)return;
      const x=touch.x>=0&&touch.x<=controlWidth?touch.x:touch.absoluteX-translation.value.x;
      const y=touch.y>=0&&touch.y<=controlHeight?touch.y:touch.absoluteY-translation.value.y;
      const slot=Math.min(slots-1,Math.max(0,Math.floor((x-1)/slotWidth)));
      pressedSlot.value=slot;
      pressedOpacity.value=y>=0 && y<=buttonHeight && !(disabledSlots&(1<<slot))?1:0;
    })
    .onTouchesUp(()=>{
      'worklet';
      pressedOpacity.value=withDelay(65,withTiming(0,{duration:65}));
    })
    .onTouchesCancelled(()=>{'worklet';pressedOpacity.value=withTiming(0,{duration:90});})
    .onStart(event=>{
      'worklet';
      const now=Date.now();
      pressedOpacity.value=0;
      origin.value=translation.value;
      dragging.value=true;
      timing.value={start:now,last:now,inputs:0,maxGap:0,slowGaps:0};
      move(event.translationX,event.translationY);
    })
    .onUpdate(event=>{
      'worklet';
      const now=Date.now(),previous=timing.value,gap=Math.max(0,now-previous.last);
      timing.value={start:previous.start,last:now,inputs:previous.inputs+1,
        maxGap:Math.max(previous.maxGap,gap),slowGaps:previous.slowGaps+(gap>=34?1:0)};
      move(event.translationX,event.translationY);
    })
    .onEnd((event,success)=>{
      'worklet';
      if(success)move(event.translationX,event.translationY);
      dragging.value=false;
      scheduleOnRN(commitDrag,translation.value,limits.value,timing.value,Date.now(),!success);
    }),[buttonHeight,commitDrag,controlHeight,controlWidth,disabledSlots,dragging,limits,move,origin,pressedOpacity,pressedSlot,slots,slotWidth,timing,translation]);
  const buttonStyle=({pressed,focused}:any)=>[styles.button,{height:buttonHeight},pressed&&{backgroundColor:'#465572'},focused&&{outlineColor:'#70d5ff',outlineStyle:'solid',outlineWidth:2}];
  return <GestureDetector gesture={pan}><Animated.View ref={nativeView} collapsable={false} onLayout={protectGesture} testID={grouped?'match-floating-controls':undefined} style={[styles.position,{left:0,top:0,width:controlWidth,height:controlHeight},style]}>
    <Animated.View pointerEvents="none" accessible={false} style={[styles.pressHighlight,{width:slotWidth,height:buttonHeight},pressedStyle]}/>
    <Pressable android_ripple={{color:'#465572'}} accessibilityRole="button" accessibilityLabel={bugButtonLabel()}
      onPress={openBugReport} style={buttonStyle} testID="bug-report-button"><BugGlyph/></Pressable>
    {onMenuPress&&<Pressable android_ripple={{color:'#465572'}} accessibilityRole="button" accessibilityLabel={copyText('Match menu')} accessibilityState={{expanded:menuExpanded}}
      onPress={onMenuPress} style={buttonStyle} testID="match-menu-button"><MenuGlyph/></Pressable>}
    {buttons.map(control=><Pressable android_ripple={{color:'#465572'}} key={control.id} accessibilityRole="button" accessibilityLabel={control.label} accessibilityState={{disabled:control.disabled}} disabled={control.disabled}
      onPress={()=>{if(!control.disabled){recordDiagnosticEvent('press',{label:control.label});control.onPress();}}} style={state=>[buttonStyle(state),control.disabled&&styles.disabled]} testID={control.id}><HistoryGlyph kind={control.kind}/></Pressable>)}
    {grouped&&history&&<Text testID="history-status" pointerEvents="none" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.historyStatus}>{history.atEnd?copyText('Live board'):copyText('Replay · move {v0} of {v1}',{v0:history.position,v1:history.total})}</Text>}
  </Animated.View></GestureDetector>;
}
const styles=StyleSheet.create({position:{position:'absolute',flexDirection:'row',direction:'ltr',backgroundColor:'#171c2a',borderWidth:1,borderColor:'#3b4760',borderRadius:8,zIndex:2147483647,elevation:100},
  pressHighlight:{position:'absolute',left:0,top:0,backgroundColor:'#465572',borderRadius:7},
  button:{flex:1,minWidth:0,alignItems:'center',justifyContent:'center',borderRadius:7},disabled:{opacity:.35},
  historyStatus:{position:'absolute',left:4,right:4,bottom:2,height:17,fontSize:11,lineHeight:16,textAlign:'center',color:'#b8c2d5'}});
