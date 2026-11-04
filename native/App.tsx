import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CameraScreen from './src/CameraScreen';
import CardsScreen from './src/CardsScreen';
import DetailSheet from './src/DetailSheet';
import IdentifySheet from './src/IdentifySheet';
import MapScreen from './src/MapScreen';
import ProfileScreen from './src/ProfileScreen';
import RevealModal from './src/RevealModal';
import { AppProvider, useApp } from './src/store';
import { C } from './src/theme';
import { Toast } from './src/ui';

type Tab = 'camera' | 'cards' | 'map' | 'profile';
const TABS: [Tab, string, string][] = [
  ['camera', '◎', 'Chasser'],
  ['cards', '▦', 'Cartes'],
  ['map', '⌖', 'Carte'],
  ['profile', '☺', 'Profil'],
];

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Main />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const { list, toastText } = useApp();
  const [tab, setTab] = useState<Tab>('camera');
  const [mapOpened, setMapOpened] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => { if (tab === 'map') setMapOpened(true); }, [tab]);

  const cards = list.filter((c) => c.valid).length;

  return (
    <SafeAreaView style={st.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        {/* La caméra reste montée (modèle chargé) mais ne tourne que sur son onglet, app au premier plan. */}
        <View style={[StyleSheet.absoluteFill, tab !== 'camera' && st.hidden]} pointerEvents={tab === 'camera' ? 'auto' : 'none'}>
          <CameraScreen active={tab === 'camera' && foreground} />
        </View>
        {tab === 'cards' && <View style={StyleSheet.absoluteFill}><CardsScreen /></View>}
        {/* La carte reste montée une fois ouverte (pas de rechargement des tuiles). */}
        {mapOpened && <View style={[StyleSheet.absoluteFill, tab !== 'map' && st.hidden]} pointerEvents={tab === 'map' ? 'auto' : 'none'}><MapScreen /></View>}
        {tab === 'profile' && <View style={StyleSheet.absoluteFill}><ProfileScreen /></View>}
      </View>
      <View style={st.tabs}>
        {TABS.map(([k, icon, label]) => (
          <Pressable key={k} style={st.tab} onPress={() => setTab(k)}>
            <Text style={[st.tabIcon, tab === k && st.active]}>{icon}</Text>
            <Text style={[st.tabText, tab === k && st.active]}>{k === 'cards' && cards ? `${label} (${cards})` : label}</Text>
          </Pressable>
        ))}
      </View>
      <IdentifySheet />
      <RevealModal />
      <DetailSheet />
      <Toast text={toastText} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  hidden: { opacity: 0, zIndex: -1 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.bg },
  tab: { flex: 1, paddingTop: 8, paddingBottom: 6, alignItems: 'center' },
  tabIcon: { color: C.dim, fontSize: 20 },
  tabText: { color: C.dim, fontSize: 12, fontWeight: '600', marginTop: 2 },
  active: { color: C.text },
});
