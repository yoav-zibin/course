import React from 'react';
import type { GProps } from 'react-native-svg';

// RN Web maps accessibilityRole="button" to an HTML <button>. SVG groups
// must remain SVG <g> nodes, so apply the same semantics directly on the web.
type Props=GProps & {accessible?:boolean;accessibilityLabel?:string;accessibilityRole?:string;accessibilityState?:{disabled?:boolean;selected?:boolean};accessibilityElementsHidden?:boolean;importantForAccessibility?:string;testID?:string};
export default function SceneGroup({accessible,accessibilityLabel,accessibilityRole,accessibilityState,onPress,pointerEvents,accessibilityElementsHidden,importantForAccessibility,testID,...rest}:Props) {
  const role=accessibilityRole==='image'?'img':accessibilityRole;
  const enabled=!!onPress&&!accessibilityState?.disabled;
  return React.createElement('g',{
    ...(rest as React.SVGProps<SVGGElement>),role:role as React.AriaRole,
    'aria-label':accessible===false?undefined:accessibilityLabel,
    'aria-disabled':role==='button'?!enabled:undefined,
    'aria-selected':accessibilityState?.selected,
    'aria-hidden':accessibilityElementsHidden||undefined,
    'data-testid':testID,
    tabIndex:role==='button'?(enabled?0:-1):undefined,
    pointerEvents,
    // Pointer clicks have already gone through the board's gesture responder.
    // Assistive clicks (detail=0) and keyboard activation retain their own path.
    onClick:enabled?event=>{if(event.detail===0)onPress?.(event as never);}:undefined,
    onKeyDown:event=>{if(enabled&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onPress?.(event as never);}},
  });
}
