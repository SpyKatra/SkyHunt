import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { PROTOTYPE_POINTS, VALIDATION } from './config';
import { addCapture } from './storage';
import type { Capture } from './types';
import { useAircraftDetector } from './useAircraftDetector';
import { checkDetection } from './validation';

type Props = {
  onCaptured: (list: Capture[], last: Capture) => void;
};

export default function CameraScreen({ onCaptured }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);

  const [rotationOffset, setRotationOffset] = useState(0);
  const [showDebug, setShowDebug] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { frameProcessor, detection, modelState, modelError } = useAircraftDetector(rotationOffset);
  const check = checkDetection(detection);

  useEffect(() => {
    if (!hasPermission) requestPermission();
    Location.requestForegroundPermissionsAsync().catch(() => {});
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const takeCapture = useCallback(async () => {
    if (camera.current == null || busy) return;
    setBusy(true);
    // On fige le verdict au moment du déclenchement.
    const snapshot = detection;
    const verdict = checkDetection(snapshot);
    try {
      const photo = await camera.current.takePhoto({ enableShutterSound: false });

      let loc: Location.LocationObject | null = null;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        }
      } catch {
        loc = null;
      }

      const capture: Omit<Capture, 'photoUri'> = {
        id: `${Date.now()}`,
        takenAt: new Date().toISOString(),
        latitude: loc?.coords.latitude ?? null,
        longitude: loc?.coords.longitude ?? null,
        accuracy: loc?.coords.accuracy ?? null,
        mockedLocation: loc?.mocked === true,
        confidence: snapshot?.confidence ?? 0,
        sizeRatio: snapshot?.sizeRatio ?? 0,
        sharpness: snapshot?.sharpness ?? 0,
        brightness: snapshot?.brightness ?? 0,
        valid: verdict.ok && loc?.mocked !== true,
        reasons: loc?.mocked === true ? [...verdict.reasons, 'Position fictive détectée'] : verdict.reasons,
        points: verdict.ok && loc?.mocked !== true ? PROTOTYPE_POINTS : 0,
      };

      const list = await addCapture(photo.path, capture);
      setToast(capture.valid ? `+${capture.points} points !` : 'Ajoutée au carnet, 0 point');
      onCaptured(list, list[0]);
    } catch (e) {
      setToast(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, detection, onCaptured]);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>SkyHunt a besoin de la caméra.</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Autoriser la caméra</Text>
        </Pressable>
      </View>
    );
  }
  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Aucune caméra arrière trouvée.</Text>
      </View>
    );
  }

  const aspect = detection?.aspect ?? 3 / 4;
  const box = detection?.found && detection.confidence >= VALIDATION.minConfidence ? detection.box : null;
  const boxColor = check.ok ? '#22C55E' : '#F59E0B';

  return (
    <View style={styles.container}>
      {/* Zone aux proportions exactes de l'image analysée : le cadre suit l'avion. */}
      <View style={[styles.preview, { aspectRatio: aspect }]}>
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          photo
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
          resizeMode="cover"
          enableZoomGesture
        />
        {box && (
          <View
            pointerEvents="none"
            style={[
              styles.box,
              {
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                borderColor: boxColor,
              },
            ]}
          >
            <Text style={[styles.boxLabel, { backgroundColor: boxColor }]}>
              Avion {Math.round((detection?.confidence ?? 0) * 100)} %
            </Text>
          </View>
        )}
      </View>

      <View style={styles.topBar}>
        <Text style={[styles.status, { color: check.ok ? '#22C55E' : '#F8FAFC' }]}>
          {modelState === 'loading' ? 'Chargement du modèle…' : modelError ? `Modèle : ${modelError}` : check.message}
        </Text>
      </View>

      {showDebug && detection && (
        <View style={styles.debug}>
          <Text style={styles.debugText}>Confiance : {Math.round(detection.confidence * 100)} % (min {Math.round(VALIDATION.minConfidence * 100)})</Text>
          <Text style={styles.debugText}>Taille : {Math.round(detection.sizeRatio * 100)} % (min {Math.round(VALIDATION.minSizeRatio * 100)})</Text>
          <Text style={styles.debugText}>Netteté : {Math.round(detection.sharpness)} (min {VALIDATION.minSharpness})</Text>
          <Text style={styles.debugText}>Luminosité : {Math.round(detection.brightness)}</Text>
          <Text style={styles.debugText}>Analyse : {Math.round(detection.inferenceMs)} ms</Text>
          <Pressable onPress={() => setRotationOffset((r) => (r + 1) % 4)} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>↻ Orientation ({rotationOffset * 90}°)</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.bottomBar}>
        <Pressable onPress={() => setShowDebug((v) => !v)} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>{showDebug ? 'Masquer diag.' : 'Diagnostic'}</Text>
        </Pressable>
        <Pressable
          onPress={takeCapture}
          disabled={busy}
          style={[styles.shutter, { borderColor: check.ok ? '#22C55E' : '#94A3B8' }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <View style={[styles.shutterInner, { backgroundColor: check.ok ? '#22C55E' : '#E2E8F0' }]} />}
        </Pressable>
        <View style={{ width: 96 }} />
      </View>

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  preview: { width: '100%', overflow: 'hidden', alignSelf: 'center', maxHeight: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1220', padding: 24 },
  text: { color: '#F8FAFC', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: '#2563EB', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600' },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 6 },
  boxLabel: { position: 'absolute', top: -22, left: -3, color: '#000', fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  topBar: { position: 'absolute', top: 12, left: 12, right: 12, backgroundColor: 'rgba(11,18,32,0.75)', borderRadius: 12, padding: 12 },
  status: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  debug: { position: 'absolute', top: 70, left: 12, backgroundColor: 'rgba(11,18,32,0.75)', borderRadius: 10, padding: 10 },
  debugText: { color: '#CBD5E1', fontSize: 12, fontVariant: ['tabular-nums'] },
  bottomBar: { position: 'absolute', bottom: 24, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30 },
  smallBtn: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 6, width: 96, alignItems: 'center' },
  smallBtnText: { color: '#F8FAFC', fontSize: 12 },
  toast: { position: 'absolute', bottom: 120, alignSelf: 'center', backgroundColor: 'rgba(11,18,32,0.9)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  toastText: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
});
