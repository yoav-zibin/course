import {copyText} from '../platform/i18n';
let open=()=>{};
export const bugButtonLabel=()=>copyText('Report a bug or request a feature');
export function configureBugControl(callback:()=>void) {open=callback;return()=>{if(open===callback)open=()=>{};};}
export function openBugReport(){open();}
