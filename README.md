# ThreeJS Playable Template (Vite, yamanabilir build)

Oyun **bir kez** build edilir. Varyantlar (metin, renk, sayı, görsel/ses değişiklikleri), diller ve reklam ağları
build'e dokunmadan, HTML içindeki veri blokları değiştirilerek üretilir.

```bash
npm install
npm run dev          # http://localhost:5173 — sol alttaki "⚙ Params" paneli ile alanları dene
npm run build        # dist/index.html (tek dosya "release") + dist/manifest.json
npm run export -- --variant=variants/example-tr.json --networks=applovin,unity --langs=en,tr
npm run export:all   # tüm ağlar, varyantsız
```

## Nasıl çalışır

| Dosya | Görev |
|---|---|
| `src/params.js` | **Tek kaynak.** Oyunun tüm config'i. `num/bool/color/text/image/...` ile sarılan değerler düzenlenebilir, düz değerler sabit. Asset'ler kullanan component'in içinde `assets: {...}` altında. |
| `playable/kit/` | Tarayıcı runtime'ı: `params.js` + HTML'deki bloklar → `gameConfig`; ağ (store açma, MRAID/DAPI); önizleme köprüsü. |
| `playable/build/` | Vite eklentisi: tek HTML + manifest üretir. |
| `playable/export/` | Exporter: release + varyant → ağ/dil dosyaları (build yok, saf metin işlemi). |
| `playable/dev/panel.js` | Sadece `npm run dev`'de açılan parametre paneli. |
| `lib/playinFramework3D/` | Mevcut component framework'ü (config/asset girişi kit'e bağlandı). |

Build çıktısındaki bloklar:

```html
<!--pl:network-->  window.__PL_NETWORK__ = "default"          ← export'ta ağ adı yazılır
<!--pl:manifest--> düzenlenebilir alanların şeması              ← Studio/panel okur, export'ta silinir
<!--pl:config-->   { "yol": değer }  override'lar               ← varyant buraya yazılır
<!--pl:assets-->   <script data-pl-asset="logo.png">base64      ← değiştirilir / kapalıysa 1x1'e indirilir
<!--pl:game-->     oyun kodu (IIFE)
```

## Alan tanımlama (`src/params.js`)

```js
ctaButton1: group("In-game CTA", {
  componentType: "orthographic",                 // sabit
  position: pos(0.75, 0.05, 0.85, 0.1),          // portrait x/y, landscape x/y — 0..1 slider
  scale: orient(0.35, 0.4, { min: 0.05, max: 2 }),
  localization: loc({                            // dil bloğu: bir kez yazılır, her dile açılır
    caption: text("PLAY NOW"),                   // veya text({ en: "PLAY NOW", tr: "HEMEN OYNA" })
    fontColor: color("#ffffff"),
    fontFamily: FONT
  }),
  isEnabled: bool(true),                         // false olursa bu component'in görselleri export'ta çıkar
  assets: { ctaButton: image("inGameCTAButton.png") }   // yol: assets/ klasörüne göre
})
```

Alan tipleri: `num, bool, color, text, select, language, image, sound, model (.glb / .glb.zip), font`.
Yardımcılar: `group(label, {...})`, `loc({...})`, `pos(...)`, `orient(...)`.

**Bir alanı yeniden adlandırırken** eski yolu yaz: `num(1, { was: "components.x.oldName" })`.
Mevcut varyantlar otomatik taşınır; bilinmeyen yollar hata vermez, "yok sayıldı" olarak raporlanır.

## Varyant dosyası

```json
{
  "name": "red-cta",
  "overrides": {
    "components.ctaButton1.localization.caption": { "en": "TRY IT", "tr": "HEMEN DENE" },
    "components.banner1.color": "#ffcc00",
    "components.inGameLogo1.assets.logo": "file:../assets/logo3.png"
  }
}
```

`file:` yolları varyant dosyasına göredir. Dev panelindeki **Download variant** aynı formatta dosya indirir
(yüklenen görseller dosyanın içine gömülü gelir).

## Önizleme köprüsü (Studio için)

Oyunu iframe'de açan bir sayfa şunu gönderir; oyun yeni değerlerle yeniden başlar:

```js
iframe.contentWindow.postMessage({ type: "pl:preview", overrides: {...}, assets: { "u/abc.png": "data:image/png;base64,..." } }, "*");
iframe.contentWindow.postMessage({ type: "pl:reset" }, "*");
// oyun hazır olunca parent'a { type: "pl:ready", overrides, languages } yollar
```

## Ağlar

`default, applovin, ironsource, smadex, unity, mintegral, appgrowth, moloco, facebook, google, liftoff, tiktok`

Ağların runtime davranışı `playable/kit/networks.js`'te, export anındaki farkları (head tag'leri, JS'i ayrı
dosyaya ayırma, TikTok için asset klasörü, metin değişimleri) `playable/export/networks.js`'te.
İkisi de `@common-packages/ad-network-settings`'ten taşındı; private registry gerekmiyor.
Boyut limitleri (`maxMb`) uyarı içindir — ağların güncel spesifikasyonuyla kontrol edin.
