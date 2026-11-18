import React from 'react';
import {View} from 'react-native';
import {reportClientIssue} from '../core/reporting';
import {Button,Copy,Title,colors} from './components';
export class ErrorBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error){reportClientIssue('render_error',error);}
  render(){if(!this.state.failed)return this.props.children;return <View style={{flex:1,padding:32,gap:20,justifyContent:'center',backgroundColor:colors.background}}><Title>Let’s try that again</Title><Copy>The screen could not load. Your saved games remain on this device.</Copy><Button onPress={()=>this.setState({failed:false})}>Reload the screen</Button></View>;}
}
