import {diagnosticSessionId,recordDiagnosticLog} from '../core/diagnostics';
import {isQuotaError} from './recoverable-cache';

let session = '', failures = new Map<string,number>();
/** Cache failures belong in reports, without exposing cached values or filling
 * the flight recorder with the same background-poll failure repeatedly. */
export function reportCacheFailure(operation:string,error:unknown):void {
  const current=diagnosticSessionId();
  if(session!==current){session=current;failures.clear();}
  const reason=isQuotaError(error)?'quota':'unavailable',key=`${operation}:${reason}`,now=Date.now();
  const previous=failures.get(key);
  if(previous!==undefined&&now>=previous&&now-previous<60000)return;
  failures.delete(key);failures.set(key,now);
  if(failures.size>32)failures.delete(failures.keys().next().value!);
  recordDiagnosticLog('error','Device cache could not be saved; continuing with session data.',{operation,reason});
}
