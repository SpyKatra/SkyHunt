// Carte du monde des captures (web/ui-map.js) : Leaflet + tuiles OpenStreetMap dans une WebView.
// Pas de clé Google Maps nécessaire. Leaflet est servi par notre propre site (GitHub Pages).
import { type ComponentType, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

// react-native-webview 14 : le type par défaut de la classe (P = undefined) rend toutes les props
// « never » ; on le retype simplement.
type WebHandle = { injectJavaScript(script: string): void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebHandle> }>;
import { getType, RARITIES } from './shared';
import { useApp } from './store';
import { C, fmtDate } from './theme';
import { Btn, placeLabel } from './ui';

const LEAFLET = 'https://spykatra.github.io/SkyHunt/vendor/leaflet';

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET}/leaflet.css">
<style>
  html,body,#map{margin:0;height:100%;background:#0b1220}
  .leaflet-popup-content{font:14px -apple-system,Roboto,sans-serif;margin:10px 12px}
  .pop b{font-size:15px} .pop a{display:inline-block;margin-top:6px;color:#2563eb;font-weight:700;text-decoration:none}
</style></head><body><div id="map"></div>
<script src="${LEAFLET}/leaflet.js"></script>
<script>
  var map = L.map('map', { zoomControl: false }).setView([46.79, -71.39], 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  var layer = L.layerGroup().addTo(map), pts = [];
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  window.fit = function(){ if(pts.length===1) map.setView(pts[0],13); else if(pts.length>1) map.fitBounds(pts,{padding:[40,40],maxZoom:13}); };
  window.setData = function(items){
    layer.clearLayers(); pts = [];
    items.forEach(function(it){
      var m = L.circleMarker([it.lat, it.lon], { radius: 8 + it.order * 2, color: '#0b1220', weight: 2, fillColor: it.color, fillOpacity: 0.95 });
      m.bindPopup('<div class="pop"><b>'+esc(it.name)+'</b><br>'+esc(it.label)+' · '+it.points+' pts<br>'+esc(it.place)+' · '+esc(it.date)
        +'<br><a href="#" onclick="window.ReactNativeWebView.postMessage(\\''+it.id+'\\');return false;">Voir la carte</a></div>');
      m.addTo(layer); pts.push([it.lat, it.lon]);
    });
    fit();
  };
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;

export default function MapScreen() {
  const { list, openDetail } = useApp();
  const web = useRef<WebHandle>(null);
  const [ready, setReady] = useState(false);

  const items = useMemo(() => list
    .filter((c) => c.valid && c.latitude != null && c.longitude != null)
    .map((c) => {
      const t = getType(c.typeId);
      const r = RARITIES[t.rarity];
      return { id: c.id, lat: c.latitude, lon: c.longitude, name: t.name, label: r.label, color: r.color, order: r.order, points: c.points, place: placeLabel(c), date: fmtDate(c.takenAt) };
    }), [list]);
  const places = useMemo(() => new Set(items.map((i) => i.place)).size, [items]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.setData(${JSON.stringify(items)});true;`);
  }, [ready, items]);

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = e.nativeEvent.data;
    if (msg === 'ready') setReady(true);
    else openDetail(msg);
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={web}
        source={{ html: HTML, baseUrl: 'https://spykatra.github.io/SkyHunt/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        style={{ flex: 1, backgroundColor: C.bg }}
        setSupportMultipleWindows={false}
      />
      <View style={st.info}>
        <Text style={st.infoText}><Text style={st.b}>{items.length}</Text> captures · <Text style={st.b}>{places}</Text> lieux</Text>
        <Btn label="Recentrer" onPress={() => web.current?.injectJavaScript('window.fit();true;')} style={st.fit} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  info: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(11,18,32,0.88)', borderRadius: 12, paddingLeft: 14, padding: 6 },
  infoText: { color: C.text2, fontSize: 14 },
  b: { color: C.text, fontWeight: '800' },
  fit: { minHeight: 36, paddingVertical: 6 },
});
