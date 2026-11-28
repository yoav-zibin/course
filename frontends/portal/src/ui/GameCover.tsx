import React,{useEffect,useState} from 'react';
import {Image,Platform,StyleSheet,View} from 'react-native';
import {parse,SvgAst,type JsxAST} from 'react-native-svg';
import {diagnosticPath,recordDiagnosticLog} from '../core/diagnostics';
import {Copy,colors} from './components';

export function GameCover({uri,label}:{uri?:string;label:string}) {
  // The versioned catalog cover endpoint serves approved SVG, including on iOS.
  const [nativeCover,setNativeCover]=useState<{uri:string;art:JsxAST}>();
  const [failedUri,setFailedUri]=useState<string>();
  useEffect(()=>{
    if(Platform.OS==='web'||!uri)return;
    const request=new AbortController();
    void (async()=>{
      try{
        const response=await fetch(uri,{signal:request.signal});
        if(!response.ok)throw new Error('Cover request failed');
        const source=await response.text();
        if(request.signal.aborted)return;
        const art=parse(source);
        if(art?.tag!=='svg')throw new Error('Invalid cover');
        setNativeCover({uri,art});
      }catch{
        if(!request.signal.aborted)recordDiagnosticLog('warn','game_cover_load_failed',diagnosticPath(uri));
      }
    })();
    return ()=>request.abort();
  },[uri]);

  return <View style={styles.cover}>
    {uri&&Platform.OS==='web'&&failedUri!==uri
      ? <Image source={{uri}} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={label}
          onError={()=>{setFailedUri(uri);recordDiagnosticLog('warn','game_cover_load_failed',diagnosticPath(uri));}}/>
      : uri&&nativeCover?.uri===uri
        ? <SvgAst ast={nativeCover.art} override={{width:'100%',height:'100%',preserveAspectRatio:'xMidYMid meet',
            accessible:true,accessibilityRole:'image',accessibilityLabel:label}}/>
        : <Copy style={styles.placeholder}>◇</Copy>}
  </View>;
}

const styles=StyleSheet.create({
  cover:{width:'100%',height:132,borderRadius:8,backgroundColor:'#222a3d',
    overflow:'hidden',alignItems:'center',justifyContent:'center'},
  placeholder:{fontSize:44,color:colors.blue},
});
