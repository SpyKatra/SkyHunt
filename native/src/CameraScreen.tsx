// Écran « Chasser » : caméra, détection en direct, zoom optique, capture → identification → révélation.
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { checkDetection, computeStats, DEFAULT_THRESHOLDS, levelFor, SCREEN_CLASSES } from './shared';
import { keepPhoto } from './storage';
import { useApp } from './store';
import { C } from './theme';
import type { Capture } from './types';
import { Bar } from './ui';
import { useAircraftDetector } from './useAircraftDetector';

const APP_VERSION = '0.5';
const USER_AGENT = `SkyHunt/${APP_VERSION} (${Platform.OS} ${Platform.Version}; ${String((Platform.constants as Record<string, unknown>).Model ?? '')})`;

export default function CameraScreen({ active }: { active: boolean }) {
  const { list, saveNew, identify, reveal, toast } = useApp();
  const { hasPermission, requestPermission } = useCameraPermission();
  // iPhone : appareil « virtuel » qui passe tout seul de l'ultra grand-angle au téléobjectif selon le zoom.
  // Android : la caméra arrière par défaut (logique) fait déjà ce passage ; le filtre y est risqué car
  // les caméras physiques ne sont pas décrites et le tri peut retenir une caméra secondaire.
  const device = useCameraDevice('back', Platform.OS === 'ios'
    ? { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] }
    : undefined);
  // Photo 4:3 de 12 Mpx (comme l'image analysée : le cadre détecté correspond à la photo). La pleine
  // résolution (50-200 Mpx sur Android) alourdit la session caméra et ralentit l'aperçu, sans rien
  // apporter à la lecture de l'immatriculation (l'envoi est de toute façon réduit à 1920 px).
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: 0.95,
    qualityPrioritization: 'quality',
  });

  const [showDebug, setShowDebug] = useState(false);
  // Erreurs de la caméra : le message natif contient toute la pile Java, illisible dans un toast.
  // On n'affiche que la 1re ligne et on garde les 3 dernières pour le diagnostic.
  const [camErrors, setCamErrors] = useState<string[]>([]);
  const [sessionInfo, setSessionInfo] = useState("");
  const onCamError = useCallback((e: Error) => {
    const head = String(e?.message ?? e).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('at ')).slice(0, 2).join(' — ').slice(0, 300);
    console.log(`[SkyHunt] erreur caméra : ${head}`);
    const t = new Date().toLocaleTimeString('fr-CA');
    setCamErrors((list) => [`${t} ${head}`, ...list].slice(0, 3));
    // « Camera is not active » : réglage (zoom…) envoyé avant le démarrage ; sans conséquence.
    if (!/not active/i.test(head)) toast(`Caméra : ${head.slice(0, 120)}`);
  }, [toast]);
  // État de la session, et relance automatique si la caméra ne démarre pas (écran noir).
  const [camState, setCamState] = useState('démarrage…');
  const [camKey, setCamKey] = useState(0);
  const started = useRef(false);
  const onStarted = useCallback(() => { console.log('[SkyHunt] session démarrée'); started.current = true; setCamState('en marche'); }, []);
  const onStopped = useCallback(() => { console.log('[SkyHunt] session arrêtée'); started.current = false; setCamState('arrêtée'); }, []);
  const onInterrupted = useCallback((r: unknown) => setCamState(`interrompue (${String(r)})`), []);
  const onResumed = useCallback(() => setCamState('en marche'), []);
  const [busy, setBusy] = useState(false);
  const thresholds = DEFAULT_THRESHOLDS;

  const { frameOutput, detection, gpu, gpuError, modelState, modelError } = useAircraftDetector();
  const outputs = useMemo(() => [photoOutput, frameOutput], [photoOutput, frameOutput]);
  const check = checkDetection(detection, thresholds);

  const stats = useMemo(() => computeStats(list), [list]);
  const lv = levelFor(stats.xp);

  /* ---------------- Zoom ---------------- */
  // Zoom « 1× » = objectif principal. Android : valeurs déjà relatives (ultra grand-angle < 1).
  // iPhone (appareil virtuel) : 1 = ultra grand-angle, le principal est au 1er seuil de bascule.
  const neutral = device == null ? 1
    : device.minZoom < 1 ? 1
    : device.zoomLensSwitchFactors.length > 0 && device.physicalDevices.some((d) => d.type === 'ultra-wide-angle')
      ? device.zoomLensSwitchFactors[0]
      : device.minZoom;
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 1, neutral * 20);
  const [zoom, setZoom] = useState(neutral);
  useEffect(() => { setZoom(neutral); }, [neutral]);
  const presets = useMemo(() => {
    const out: number[] = [];
    if (minZoom < neutral * 0.9) out.push(minZoom / neutral);
    for (const f of [1, 2, 3, 5, 10]) if (neutral * f <= maxZoom + 0.01) out.push(f);
    return out;
  }, [minZoom, neutral, maxZoom]);
  const factor = zoom / neutral;

  const pinch = useRef({ start: 0, dist: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length !== 2) return;
      const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
      if (!pinch.current.dist) { pinch.current = { start: zoomRef.current, dist: d }; return; }
      const z = pinch.current.start * (d / pinch.current.dist);
      setZoom(Math.max(minZoom, Math.min(maxZoom, z)));
    },
    onPanResponderRelease: () => { pinch.current = { start: 0, dist: 0 }; },
    onPanResponderTerminate: () => { pinch.current = { start: 0, dist: 0 }; },
  }), [minZoom, maxZoom]);

  /* ---------------- Position GPS ---------------- */
  const position = useRef<Location.LocationObject | null>(null);
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
        (p) => { position.current = p; },
      );
      if (cancelled) sub.remove();
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [active]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Chien de garde : si la caméra n'a pas démarré 5 s après l'ouverture, on recrée la session
  // (3 essais au plus). Évite l'écran noir qui obligeait à fermer l'app.
  const retries = useRef(0);
  useEffect(() => {
    console.log(`[SkyHunt] caméra : active=${active} perm=${hasPermission} device=${device?.id ?? 'null'} key=${camKey}`);
  }, [active, hasPermission, device, camKey]);
  useEffect(() => {
    console.log('[SkyHunt] CameraScreen monté');
    return () => console.log('[SkyHunt] CameraScreen démonté');
  }, []);
  useEffect(() => {
    if (!active) { retries.current = 0; started.current = false; setCamState('démarrage…'); return; }
    if (!hasPermission || device == null) return;
    started.current = false;
    const timer = setTimeout(() => {
      if (started.current || retries.current >= 3) return;
      retries.current += 1;
      setCamState(`relance ${retries.current}/3`);
      setCamKey((k) => k + 1);
    }, 5000);
    return () => clearTimeout(timer);
  }, [active, hasPermission, device, camKey]);

  /* ---------------- Capture ---------------- */
  const takeCapture = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // On fige le verdict au moment du déclenchement.
    const snapshot = detection;
    const verdict = checkDetection(snapshot, thresholds);
    try {
      const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off', enableShutterSound: false }, {});
      let pos = position.current;
      if (!pos) {
        pos = await Location.getLastKnownPositionAsync({ maxAge: 60000 }).catch(() => null);
      }
      const id = `${Date.now()}`;
      const photoUri = await keepPhoto(id, photo.filePath);
      const mocked = pos?.mocked === true;
      const reasons = [...verdict.reasons];
      if (!pos) reasons.push('Position GPS inconnue');
      if (mocked) reasons.push('Position fictive détectée');
      const valid = verdict.ok && !!pos && !mocked;

      const record: Capture = {
        id,
        takenAt: new Date().toISOString(),
        photoUri,
        width: photo.width,
        height: photo.height,
        latitude: pos?.coords.latitude ?? null,
        longitude: pos?.coords.longitude ?? null,
        accuracy: pos?.coords.accuracy ?? null,
        gpsAgeS: pos ? Math.round((Date.now() - pos.timestamp) / 1000) : null,
        confidence: snapshot?.confidence ?? 0,
        sizeRatio: snapshot?.sizeRatio ?? 0,
        sharpness: snapshot?.sharpness ?? 0,
        brightness: snapshot?.brightness ?? 0,
        moire: snapshot?.moire ?? null,
        screenObject: snapshot?.screenObject ?? null,
        box: snapshot?.box ?? null,
        thresholds: { ...thresholds },
        valid,
        reasons,
        typeId: null,
        registration: null,
        registrationSource: null,
        registryModel: null,
        userAgent: USER_AGENT,
        zoom: Math.round(factor * 10) / 10,
      };

      if (!valid) {
        await saveNew(record);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        toast(`Refusée : ${reasons[0] || 'photo non valide'}`);
        return;
      }

      // Capture valide : on demande le type, puis révélation de la carte.
      const ident = await identify(record);
      await new Promise((res) => setTimeout(res, 450)); // laisser la fiche se fermer (iOS)
      const res = await saveNew({ ...record, ...ident });
      await reveal(res.capture, { levelUp: res.levelUp, achievements: res.achievements });
    } catch (e) {
      toast(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, detection, thresholds, factor, photoOutput, saveNew, identify, reveal, toast]);

  /* ---------------- Rendu ---------------- */
  if (!hasPermission) {
    return (
      <View style={st.center}>
        <Text style={st.text}>SkyHunt a besoin de la caméra pour photographier les avions.</Text>
        <Pressable style={st.btn} onPress={requestPermission}><Text style={st.btnText}>Autoriser la caméra</Text></Pressable>
      </View>
    );
  }
  if (device == null) {
    // Sur Android, la liste des caméras arrive quelques instants après le lancement.
    return (
      <View style={st.center}>
        <ActivityIndicator color="#fff" />
        <Text style={st.text}>Ouverture de la caméra…</Text>
      </View>
    );
  }

  const aspect = detection?.aspect ?? 3 / 4;
  const box = detection?.found && detection.confidence >= thresholds.minConfidence ? detection.box : null;
  const boxColor = check.ok ? C.ok : C.warn;
  const status = camState !== 'en marche' ? `Caméra : ${camState}` : modelState === 'loading' ? 'Chargement du modèle…' : modelError ? `Modèle : ${modelError.split('\n')[0].slice(0, 140)}` : check.message;

  return (
    <View style={st.container} {...responder.panHandlers}>
      {/* Zone aux proportions exactes de l'image analysée : le cadre suit l'avion. */}
      <View style={[st.preview, { aspectRatio: aspect }]}>
        {/* Montée seulement sur cet onglet : la caméra est entièrement libérée ailleurs. */}
        {active && (
          <Camera
            key={camKey}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            outputs={outputs}
            zoom={camState === 'en marche' ? zoom : undefined}
            resizeMode="cover"
            onSessionConfigSelected={(c) => setSessionInfo(`${c.selectedFPS ?? '?'} i/s · ${c.nativePixelFormat}${c.isBinned ? ' · binning' : ''}`)}
            onStarted={onStarted}
            onStopped={onStopped}
            onInterruptionStarted={onInterrupted}
            onInterruptionEnded={onResumed}
            onError={onCamError}
          />
        )}
        {box && (
          <View pointerEvents="none" style={[st.box, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, borderColor: boxColor }]}>
            <Text style={[st.boxLabel, { backgroundColor: boxColor }]}>Avion {Math.round((detection?.confidence ?? 0) * 100)} %</Text>
          </View>
        )}
      </View>

      <View style={st.topBar} pointerEvents="box-none">
        <View style={st.status}><Text style={[st.statusText, { color: check.ok ? C.ok : C.text }]}>{status}</Text></View>
        <View style={st.level}>
          <Text style={st.levelText}>Niv. {lv.level}</Text>
          <View style={{ width: 44 }}><Bar value={lv.progress} height={4} /></View>
        </View>
      </View>

      {showDebug && detection && (
        <View style={st.debug}>
          <Text style={st.debugText}>Confiance : {Math.round(detection.confidence * 100)} % (min {Math.round(thresholds.minConfidence * 100)})</Text>
          <Text style={st.debugText}>Taille : {Math.round(detection.sizeRatio * 100)} % (min {Math.round(thresholds.minSizeRatio * 100)})</Text>
          <Text style={st.debugText}>Netteté : {Math.round(detection.sharpness)} (min {thresholds.minSharpness})</Text>
          <Text style={st.debugText}>Luminosité : {Math.round(detection.brightness)}</Text>
          <Text style={st.debugText}>Moiré (écran) : {Math.round(detection.moire)} dB (max {thresholds.maxMoire})</Text>
          <Text style={st.debugText}>Écran détecté : {detection.screenObject ? `${SCREEN_CLASSES[detection.screenClass] ?? 'écran'} ${Math.round(detection.screenObject * 100)} %` : 'non'}</Text>
          <Text style={st.debugText}>
            Analyse : {Math.round(detection.inferenceMs)} ms (détection {detection.detectMs ?? '?'}
            {detection.moireMs != null && detection.moireMs >= 0 ? ` · moiré ${detection.moireMs}` : ''}) · {gpu ? 'GPU' : gpuError ? `CPU (GPU : ${gpuError.slice(0, 60)})` : 'CPU'} · zoom ×{factor.toFixed(1)}
          </Text>
          <Text style={st.debugText}>Caméra : {camState} · {detection.cameraFps ?? '?'} i/s reçues · image {detection.frameInfo ?? '?'} · {sessionInfo || 'configuration…'} · {USER_AGENT}</Text>
          {camErrors.map((m, i) => <Text key={i} style={[st.debugText, { color: C.warn }]}>Erreur {m}</Text>)}
          <Text style={st.debugText}>GPS : {position.current ? `±${Math.round(position.current.coords.accuracy ?? 0)} m` : 'en attente'}</Text>
        </View>
      )}

      <View style={st.zoomRow}>
        {presets.map((f) => {
          const on = Math.abs(factor - f) < 0.05;
          return (
            <Pressable key={f} onPress={() => setZoom(Math.max(minZoom, Math.min(maxZoom, f * neutral)))} style={[st.zoomBtn, on && st.zoomOn]}>
              <Text style={[st.zoomText, on && st.zoomTextOn]}>{on ? `${f < 1 ? f.toFixed(1).replace('.', ',') : f}×` : f < 1 ? '0,5' : `${f}`}</Text>
            </Pressable>
          );
        })}
        {!presets.some((f) => Math.abs(factor - f) < 0.05) && (
          <View style={[st.zoomBtn, st.zoomOn]}><Text style={[st.zoomText, st.zoomTextOn]}>{factor.toFixed(1).replace('.', ',')}×</Text></View>
        )}
      </View>

      <View style={st.bottomBar}>
        <Pressable onPress={() => setShowDebug((v) => !v)} style={st.smallBtn}>
          <Text style={st.smallBtnText}>{showDebug ? 'Masquer diag.' : 'Diagnostic'}</Text>
        </Pressable>
        <Pressable onPress={takeCapture} disabled={busy} style={[st.shutter, { borderColor: check.ok ? C.ok : C.muted }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <View style={[st.shutterInner, { backgroundColor: check.ok ? C.ok : '#E2E8F0' }]} />}
        </Pressable>
        <View style={{ width: 96 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  preview: { width: '100%', overflow: 'hidden', alignSelf: 'center', maxHeight: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 24 },
  text: { color: C.text, fontSize: 16, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: C.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 6 },
  boxLabel: { position: 'absolute', top: -22, left: -3, color: '#000', fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  topBar: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 8 },
  status: { flex: 1, backgroundColor: 'rgba(11,18,32,0.78)', borderRadius: 12, padding: 12, justifyContent: 'center' },
  statusText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  level: { backgroundColor: 'rgba(11,18,32,0.78)', borderRadius: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 4 },
  levelText: { color: C.text, fontWeight: '800', fontSize: 13 },
  debug: { position: 'absolute', top: 76, left: 12, backgroundColor: 'rgba(11,18,32,0.82)', borderRadius: 10, padding: 10 },
  debugText: { color: C.text2, fontSize: 12, fontVariant: ['tabular-nums'] },
  zoomRow: { position: 'absolute', bottom: 124, alignSelf: 'center', flexDirection: 'row', gap: 6, backgroundColor: 'rgba(11,18,32,0.55)', borderRadius: 999, padding: 4 },
  zoomBtn: { minWidth: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 6 },
  zoomOn: { backgroundColor: 'rgba(11,18,32,0.9)' },
  zoomText: { color: C.text, fontSize: 12, fontWeight: '700' },
  zoomTextOn: { color: '#facc15', fontSize: 13 },
  bottomBar: { position: 'absolute', bottom: 24, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30 },
  smallBtn: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 6, width: 96, alignItems: 'center' },
  smallBtnText: { color: C.text, fontSize: 12 },
});
