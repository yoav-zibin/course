import React,{useEffect,useState} from 'react';
import {ScrollView} from 'react-native';
import {GameRenderer} from './GameRenderer';
import type {StateMessage} from './types';

// This host runs only for platform-generated compatibility documents. It never
// initializes accounts, storage, API credentials, or the player portal.
export function EmbeddedGameHost({spec}: {spec:unknown}) {
  const [delivery,setDelivery]=useState<{message:StateMessage;key:number}|null>(null);
  const [frameHeight,setFrameHeight]=useState<number>();
  useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source===parent&&event.data?.type==='state_changed')setDelivery(previous=>({message:event.data,key:(previous?.key||0)+1}));};window.addEventListener('message',receive);parent.postMessage({type:'game_ready'},'*');return()=>window.removeEventListener('message',receive);},[]);
  // A host can reject a move and resend an identical authoritative snapshot.
  // Each real delivery re-arms its one-move gate; ordinary app renders do not.
  return <ScrollView style={{flex:1}} scrollEnabled={false} onLayout={event=>setFrameHeight(event.nativeEvent.layout.height)} contentContainerStyle={{flexGrow:1,height:'100%'}}>{delivery&&<GameRenderer spec={spec} message={delivery.message} frameHeight={frameHeight} deliveryKey={delivery.key} onMove={move=>parent.postMessage({type:'make_move',move},'*')} onScene={(scene,message)=>parent.postMessage({type:'game_scene',scene,message},'*')}/>}</ScrollView>;
}
