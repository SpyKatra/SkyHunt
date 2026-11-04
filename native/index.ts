// Supabase (supabase-js) a besoin de l'objet URL complet du web.
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';

import App from './App';
import { installCrashLog } from './src/crash';

installCrashLog();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
