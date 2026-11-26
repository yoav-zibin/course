import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import './src/platform/installDiagnostics';
import { nativeLaunch } from './src/nativeLaunch';

// Start opening local storage while React loads the native shell and gestures.
if (Platform.OS !== 'web') void nativeLaunch().catch(() => {});
const App = (require('./src/App') as typeof import('./src/App')).default;
registerRootComponent(App);
