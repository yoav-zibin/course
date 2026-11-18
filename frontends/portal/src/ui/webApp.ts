import type {Portal} from './context';
export function installWebApp() {}
export async function installPrompt() {return false;}
export async function enableNotifications(_portal:Portal) {throw new Error('Background turn notifications are available in the installed web app.');}
