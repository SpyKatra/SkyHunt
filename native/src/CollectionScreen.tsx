import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { deleteCapture } from './storage';
import type { Capture } from './types';

type Props = {
  captures: Capture[];
  onChange: (list: Capture[]) => void;
};

export default function CollectionScreen({ captures, onChange }: Props) {
  const total = captures.reduce((s, c) => s + c.points, 0);
  const valid = captures.filter((c) => c.valid).length;

  const confirmDelete = (c: Capture) => {
    Alert.alert('Supprimer cette capture ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => onChange(await deleteCapture(c.id)) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Ma collection</Text>
        <Text style={styles.sub}>
          {total} points · {valid} validées · {captures.length - valid} refusées
        </Text>
      </View>

      <FlatList
        data={captures}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.empty}>Aucune capture pour l’instant. Va photographier un avion !</Text>}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => confirmDelete(item)} style={styles.card}>
            <Image source={{ uri: item.photoUri }} style={styles.thumb} />
            <View style={{ flex: 1 }}>
              <View style={styles.row}>
                <Text style={[styles.badge, { backgroundColor: item.valid ? '#14532D' : '#7C2D12' }]}>
                  {item.valid ? 'Validée' : 'Refusée'}
                </Text>
                <Text style={styles.points}>{item.points} pts</Text>
              </View>
              <Text style={styles.meta}>{new Date(item.takenAt).toLocaleString('fr-CA')}</Text>
              <Text style={styles.meta}>
                {item.latitude != null && item.longitude != null
                  ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)} (±${Math.round(item.accuracy ?? 0)} m)`
                  : 'Position inconnue'}
              </Text>
              <Text style={styles.meta}>
                Confiance {Math.round(item.confidence * 100)} % · taille {Math.round(item.sizeRatio * 100)} % · netteté {Math.round(item.sharpness)}
              </Text>
              {item.reasons.length > 0 && <Text style={styles.reason}>{item.reasons.join(' · ')}</Text>}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { color: '#F8FAFC', fontSize: 26, fontWeight: '800' },
  sub: { color: '#94A3B8', fontSize: 14, marginTop: 4 },
  empty: { color: '#94A3B8', textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: '#111A2E', borderRadius: 14, padding: 10, marginBottom: 10 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: '#1E293B' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  badge: { color: '#F8FAFC', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  points: { color: '#FACC15', fontSize: 16, fontWeight: '800' },
  meta: { color: '#CBD5E1', fontSize: 12, marginTop: 2 },
  reason: { color: '#FDBA74', fontSize: 12, marginTop: 4 },
});
