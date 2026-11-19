import React from 'react';
import {Pressable,StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BugGlyph} from './BugGlyph';
import {bugButtonLabel,openBugReport} from './bugControl';
export function BugButton(){
  const insets=useSafeAreaInsets();
  return <Pressable accessibilityRole="button" accessibilityLabel={bugButtonLabel()} onPress={openBugReport} style={[styles.bug,{top:insets.top+2}]} testID="bug-report-button"><BugGlyph/></Pressable>;
}
const styles=StyleSheet.create({bug:{position:'absolute',left:5,top:2,width:36,height:32,alignItems:'center',justifyContent:'center',backgroundColor:'#171c2a',borderWidth:1,borderColor:'#3b4760',borderRadius:8,zIndex:2147483647,elevation:100}});
