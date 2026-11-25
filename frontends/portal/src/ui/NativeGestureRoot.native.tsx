import React,{type ReactNode} from 'react';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

export function NativeGestureRoot({children}:{children:ReactNode}){
  return <GestureHandlerRootView style={{flex:1}}>{children}</GestureHandlerRootView>;
}
