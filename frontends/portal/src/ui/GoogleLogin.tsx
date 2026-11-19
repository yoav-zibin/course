import {copyText} from '../platform/i18n';
import React from 'react';
import {Button} from './components';
export default function GoogleLogin({onBrowserLogin}: {clientId:string;onToken:(token:string)=>Promise<unknown>;onBrowserLogin:()=>Promise<unknown>}) {
  return <Button secondary onPress={onBrowserLogin}>{copyText('Continue with a verified login in your browser')}</Button>;
}
