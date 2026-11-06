import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CameraScreen from './src/CameraScreen';
import CardsScreen from './src/CardsScreen';
import { showLastCrash } from './src/crash';
import DetailSheet from './src/DetailSheet';
import { incomingCount, loadFriends, resetFriends, useFriends } from './src/friends';
import IdentifySheet from './src/IdentifySheet';
import MapScreen from './src/MapScreen';
import ProfileScreen from './src/ProfileScreen';
import RanksScreen from './src/RanksScreen';
import RevealModal from './src/RevealModal';
import { AppProvider, useApp } from './src/store';
import { C } from './src/theme';
import { Toast } from './src/ui';

type Tab = 'camera' | 'cards' | 'map' | 'ranks' | 'profile';
const TABS: [Tab, string, string][] = [
  ['camera', '◎', 'Chasser'],
  ['cards', '▦', 'Cartes'],
  ['map', '⌖', 'Carte'],
  ['ranks', '♛', 'Classement'],
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
  const { list, toastText, cloud } = useApp();
  const friends = useFriends();
  const online = !!(cloud.user && cloud.profile);
  const [tab, setTab] = useState<Tab>('camera');
  const [mapOpened, setMapOpened] = useState(false);

  useEffect(() => { showLastCrash(); }, []);
  useEffect(() => { if (tab === 'map') setMapOpened(true); }, [tab]);

  // Demandes d'amis reçues : pastille sur l'onglet Profil. Relue à la connexion et au retour dans l'app.
  // (AppState sert seulement ici, jamais pour la caméra : voir CLAUDE.md.)
  useEffect(() => {
    if (!online) { resetFriends(); return; }
    loadFriends();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') loadFriends(); });
    return () => sub.remove();
  }, [online, cloud.user?.id]);

  const cards = list.filter((c) => c.valid).length;
  const requests = online ? incomingCount(friends) : 0;

  return (
    <SafeAreaView style={st.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        {/* La caméra reste montée (modèle chargé) mais ne tourne que sur son onglet.
            Pas d'AppState : sur Android, l'ouverture de la caméra fait passer l'app un instant en
            « background » ; arrêter la caméra la remettait en « active », d'où une boucle de
            redémarrages (écran noir, lag, fermetures). VisionCamera gère seule l'arrière-plan. */}
        <View style={[StyleSheet.absoluteFill, tab !== 'camera' && st.hidden]} pointerEvents={tab === 'camera' ? 'auto' : 'none'}>
          <CameraScreen active={tab === 'camera'} />
        </View>
        {tab === 'cards' && <View style={StyleSheet.absoluteFill}><CardsScreen /></View>}
        {/* La carte reste montée une fois ouverte (pas de rechargement des tuiles). */}
        {mapOpened && <View style={[StyleSheet.absoluteFill, tab !== 'map' && st.hidden]} pointerEvents={tab === 'map' ? 'auto' : 'none'}><MapScreen /></View>}
        {tab === 'ranks' && <View style={StyleSheet.absoluteFill}><RanksScreen onGoProfile={() => setTab('profile')} /></View>}
        {tab === 'profile' && <View style={StyleSheet.absoluteFill}><ProfileScreen /></View>}
      </View>
      <View style={st.tabs}>
        {TABS.map(([k, icon, label]) => (
          <Pressable key={k} style={st.tab} onPress={() => setTab(k)}>
            <View>
              <Text style={[st.tabIcon, tab === k && st.active]}>{icon}</Text>
              {k === 'profile' && requests > 0 && <Text style={st.badge}>{requests}</Text>}
            </View>
            <Text style={[st.tabText, tab === k && st.active]} numberOfLines={1} adjustsFontSizeToFit>{k === 'cards' && cards ? `${label} (${cards})` : label}</Text>
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
  badge: { position: 'absolute', top: -4, left: 14, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, overflow: 'hidden',
    backgroundColor: '#ef4444', color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 17, textAlign: 'center' },
});
