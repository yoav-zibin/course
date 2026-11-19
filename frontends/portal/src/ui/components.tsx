import {registerNativeDialog,useNativeBugReport} from './bugModal';
import {recordDiagnosticLog,recordDiagnosticEvent} from '../core/diagnostics';
import {BugButton} from './BugButton';
import {copyText} from '../platform/i18n';
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

export const colors = {
  background: '#10141f', surface: '#171c2a', raised: '#222a3d', border: '#3b4760',
  text: '#eef0f5', muted: '#b8c2d5', accent: '#c6f432', ink: '#10141f', blue: '#70d5ff',
  purple: '#bda8ff', pink: '#ff85b7', error: '#ffaaaa', success: '#c6f432',
};

export function Copy({children, muted, small, style, ...props}: {children?: ReactNode; muted?: boolean; small?: boolean; style?: any; selectable?: boolean; numberOfLines?: number; accessibilityRole?: 'header' | 'text'; testID?: string}) {
  return <Text {...props} style={[styles.copy, muted && styles.muted, small && styles.small, style]}>{children}</Text>;
}

export function Title({children, small = false}: {children: ReactNode; small?: boolean}) {
  return <Text accessibilityRole="header" style={[styles.title, small && {fontSize: 21}]}>{children}</Text>;
}

export function Button({children, onPress, secondary, danger, disabled, busy, label, testID, compact, selected}: {
  children: ReactNode; onPress?: () => void | Promise<unknown>; secondary?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean; label?: string; testID?: string; compact?: boolean; selected?: boolean;
}) {
  const [working, setWorking] = useState(false);
  const pending = busy || working;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: Boolean(disabled || pending), selected}} testID={testID}
    disabled={disabled || pending} onPress={async () => {if (!onPress || working) return; recordDiagnosticEvent('press',{label:label||textContent(children)}); setWorking(true); try { await onPress(); } finally { setWorking(false); }}}
    style={({pressed, focused}: any) => [styles.button, secondary && styles.secondary, danger && styles.danger, selected && styles.selected, compact && {paddingVertical: 8, paddingHorizontal: 12, minHeight: 40}, (disabled || pending) && {opacity: 0.5}, pressed && {opacity: 0.8}, focused && {outlineColor: colors.blue, outlineStyle: 'solid', outlineWidth: 2}]}>
    {pending && <ActivityIndicator color={secondary ? colors.accent : colors.ink} size="small" />}
    <Text style={[styles.buttonText, secondary && {color: colors.text}, danger && {color: colors.error}, selected && {color: colors.accent}]}>{children}</Text>
  </Pressable>;
}

export function Field({label, hint, ...props}: TextInputProps & {label: string; hint?: string}) {
  return <View style={styles.fieldGroup}><Copy small style={{fontWeight: '600'}}>{label}</Copy>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={colors.muted} selectionColor={colors.accent} style={[styles.field, props.multiline && {minHeight: 96, textAlignVertical: 'top'}, props.style]} />
    {hint && <Copy small muted>{hint}</Copy>}
  </View>;
}

export function Choices<T extends string | number>({label, value, options, onChange}: {label: string; value: T; options: {value: T; label: string}[]; onChange: (value: T) => void}) {
  return <View style={styles.fieldGroup}><Copy small style={{fontWeight: '600'}}>{label}</Copy><Row>{options.map(option => <Button key={option.value} compact secondary selected={value === option.value} onPress={() => onChange(option.value)} label={`${label}: ${option.label}`}>{option.label}</Button>)}</Row></View>;
}

export function Row({children, style}: {children?: ReactNode; style?: ViewStyle | ViewStyle[]}) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Card({children, style, testID}: {children: ReactNode; style?: ViewStyle | ViewStyle[]; testID?: string}) {
  return <View testID={testID} style={[styles.card, style]}>{children}</View>;
}

function textContent(value:ReactNode):string {return React.Children.toArray(value).map(child=>typeof child==='string'||typeof child==='number'?String(child):React.isValidElement<{children?:ReactNode}>(child)?textContent(child.props.children):'').join(' ').slice(0,1000);}
export function Notice({children, error, onDismiss}: {children: ReactNode; error?: boolean; onDismiss?: () => void}) {
  const message=textContent(children);
  useEffect(()=>{if(error)recordDiagnosticLog('error','visible_error',message);},[error,message]);
  return <View accessibilityRole="alert" style={[styles.notice, error && {borderColor: colors.error}]}><Copy style={[{flex: 1}, error && {color: colors.error}]}>{children}</Copy>{onDismiss && <Button secondary compact label={copyText("Dismiss message")} onPress={onDismiss}>×</Button>}</View>;
}

export function DialogContent({title,children,onClose,wide,avoidKeyboard}: {title:string;children:ReactNode;onClose:()=>void;wide?:boolean;avoidKeyboard?:boolean}) {
  const content=<View style={[styles.modal,wide&&{maxWidth:760}]}><Row style={{justifyContent:'space-between'}}><Title small>{title}</Title><Button compact secondary label={copyText('Close dialog')} onPress={onClose}>×</Button></Row><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:18,paddingBottom:10}}>{children}</ScrollView></View>;
  return avoidKeyboard&&Platform.OS!=='web'?<KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.modalShade}>{content}</KeyboardAvoidingView>:<View style={styles.modalShade}>{content}</View>;
}
export function Dialog({visible,title,children,onClose,wide,reporting}: {visible:boolean;title:string;children:ReactNode;onClose:()=>void;wide?:boolean;reporting?:boolean}) {
  const id=useRef(Symbol('dialog')).current,captureView=useRef<React.ComponentRef<typeof View>>(null),report=useNativeBugReport();
  useEffect(()=>{if(Platform.OS!=='web'&&visible&&!reporting)return registerNativeDialog(id,captureView);},[visible,reporting,id]);
  // Web fade-out keeps focusable controls mounted after close, including when
  // another dialog opens immediately. Remove the closed web modal at once.
  if(Platform.OS==='web'&&!visible)return null;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={()=>{if(report)report.onClose();else onClose();}} accessibilityViewIsModal>
    <View ref={captureView} collapsable={false} style={{flex:1}}>
    <View style={{flex:1}} accessibilityElementsHidden={Boolean(report&&!reporting)} importantForAccessibility={report&&!reporting?'no-hide-descendants':'auto'}><DialogContent title={title} onClose={onClose} wide={wide} avoidKeyboard={reporting}>{children}</DialogContent></View>
    {Platform.OS!=='web'&&report&&!reporting&&<View style={[StyleSheet.absoluteFill,{zIndex:2147483646,elevation:99}]}>{report.content}</View>}
    {Platform.OS!=='web'&&<BugButton/>}
    </View>
  </Modal>;
}

export function Empty({children}: {children: ReactNode}) { return <Copy muted style={{paddingVertical: 20, lineHeight: 23}}>{children}</Copy>; }

export const styles = StyleSheet.create({
  copy: {fontSize: 15, lineHeight: 23, color: colors.text, flexShrink: 1, minWidth: 0}, muted: {color: colors.muted}, small: {fontSize: 13, lineHeight: 20},
  title: {color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, flexShrink: 1},
  button: {backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent, borderRadius: 8, minHeight: 44, maxWidth: '100%', paddingVertical: 11, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9},
  buttonText: {color: colors.ink, fontWeight: '700', fontSize: 14, textAlign: 'center', flexShrink: 1, minWidth: 0},
  secondary: {backgroundColor: colors.surface, borderColor: colors.border}, danger: {backgroundColor: colors.surface, borderColor: '#8c4f60'}, selected: {borderColor: colors.accent, backgroundColor: '#26321c'},
  fieldGroup: {gap: 8, flexShrink: 1}, field: {backgroundColor: colors.background, color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 46},
  row: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, minWidth: 0, maxWidth: '100%'},
  card: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 22, gap: 16, minWidth: 0, maxWidth: '100%'},
  notice: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10},
  modalShade: {flex: 1, backgroundColor: '#050915bb', justifyContent: 'center', alignItems: 'center', padding: 18},
  modal: {width: '100%', maxWidth: 530, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 22, gap: 22},
});
