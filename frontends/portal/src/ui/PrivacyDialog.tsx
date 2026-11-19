import React,{useEffect,useState} from 'react';
import {Linking,Text,View} from 'react-native';
import {copyText} from '../platform/i18n';
import policy from '../platform/privacy-policy.json';
import {Copy,Dialog,Notice,Title,colors} from './components';

type PolicyLink={placeholder:string;label:string;url:string};
type PolicyBlock={kind:string;text:string;links?:PolicyLink[]};
const blocks=policy.blocks as PolicyBlock[];

function PolicyText({block,openLink}: {block:PolicyBlock;openLink:(url:string)=>void}) {
  const translated=copyText(block.text);
  return <Copy muted={block.kind==='footer'} small={block.kind==='footer'} selectable>
    {block.kind==='bullet'?'• ':''}{translated.split(/(\{link\d+\})/g).map((part,index)=>{
      const link=block.links?.find(item=>part===`{${item.placeholder}}`);
      return link?<Text key={index} accessibilityRole="link" onPress={()=>openLink(link.url)} style={{color:colors.blue,textDecorationLine:'underline'}}>{copyText(link.label)}</Text>:part;
    })}
  </Copy>;
}

/** Bundled from the canonical public policy, including its original links.
 * The shared dialog keeps it inside the app and supports offline reading. */
export function PrivacyDialog({visible,onClose}: {visible:boolean;onClose:()=>void}) {
  const [error,setError]=useState('');
  useEffect(()=>{if(visible)setError('');},[visible]);
  const openLink=(url:string)=>{void Linking.openURL(url).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)));};
  return <Dialog visible={visible} title={copyText(blocks.find(block=>block.kind==='title')!.text)} onClose={onClose} wide>
    <View testID="privacy-policy-content" style={{gap:16}}>
      {error&&<Notice error>{error}</Notice>}
      {blocks.filter(block=>block.kind!=='title').map((block,index)=>block.kind==='heading'
        ?<Title key={index} small>{copyText(block.text)}</Title>
        :<PolicyText key={index} block={block} openLink={openLink}/>)}
    </View>
  </Dialog>;
}
