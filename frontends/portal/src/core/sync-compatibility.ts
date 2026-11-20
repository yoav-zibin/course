import {ApiError} from './api';

/** The native bundle can arrive before its matching backend release. Keep its
 * durable outbox intact and retry after deployment instead of parking a branch. */
export class RetryableSyncCompatibilityError extends Error {
  constructor(readonly original:ApiError) {super(original.message);}
}

const missingRouteReasons=new Set(['not found','method not allowed','nicht gefunden','methode nicht erlaubt',
  'introuvable','méthode non autorisée','no encontrado','método no permitido','לא נמצא','השיטה אינה מותרת',
  'غير موجود','الطريقة غير مسموح بها','не найдено','метод не разрешен']);
export function missingRouteReason(message:string):boolean {return missingRouteReasons.has(message.trim().toLowerCase());}
export function isMissingSaveRoute(error:ApiError):boolean {
  return error.status===405 || error.status===404 && missingRouteReason(error.message);
}
export function isUnsupportedCreationFields(error:ApiError):boolean {
  return error.status===422 && Array.isArray(error.detail) && error.detail.length>0 && error.detail.every(issue=>
    issue?.type==='extra_forbidden' && Array.isArray(issue.loc) && issue.loc.length===2 && issue.loc[0]==='body'
    && ['match_kind','client_match_id'].includes(issue.loc[1]));
}
