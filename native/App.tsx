import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CameraScreen from './src/CameraScreen';
import CollectionScreen from './src/CollectionScreen';
import { loadCaptures } from './src/storage';
import type { Capture } from './src/types';

type Tab = 'camera' | 'collection';

export default function App() {
  const [tab, setTab] = useState<Tab>('camera');
  const [captures, setCaptures] = useState<Capture[]>([]);

  useEffect(() => {
    loadCaptures().then(setCaptures);
  }, []);

  const onCaptured = useCallback((list: Capture[]) => setCaptures(list), []);
  const total = captures.reduce((s, c) => s + c.points, 0);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          {tab === 'camera' ? (
            <CameraScreen onCaptured={onCaptured} />
          ) : (
            <CollectionScreen captures={captures} onChange={setCaptures} />
          )}
        </View>
        <View style={styles.tabs}>
          <Pressable style={styles.tab} onPress={() => setTab('camera')}>
            <Text style={[styles.tabText, tab === 'camera' && styles.active]}>Chasser</Text>
          </Pressable>
          <Pressable style={styles.tab} onPress={() => setTab('collection')}>
            <Text style={[styles.tabText, tab === 'collection' && styles.active]}>
              Collection ({captures.length}) · {total} pts
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1220' },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', backgroundColor: '#0B1220' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: '#64748B', fontSize: 15, fontWeight: '600' },
  active: { color: '#F8FAFC' },
});
