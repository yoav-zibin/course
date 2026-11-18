import React from 'react';
import {Button} from './components';
import {useApp} from './context';
export default function GoogleLogin({clientId,onToken,link=false}: {clientId:string;onToken:(token:string)=>Promise<unknown>;link?:boolean}) {
  const {p,run}=useApp();
  return <Button secondary onPress={()=>run(()=>p.actions.browserLogin(link))}>Continue with Google in your browser</Button>;
}
