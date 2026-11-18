# 🌴 NEON BAY — Açık Dünya Mobil Oyun

Gün batımında neon ışıklı bir sahil şehrinde geçen, tarayıcıda çalışan 3D açık dünya oyunu (Three.js).
Telefonda ve bilgisayarda çalışır, kurulum gerekmez.

## Özellikler
- **8x8 bloklu dev şehir**: cam gökdelenler, pastel sahil otelleri, neon tabelalar, parklar, palmiyeler
- **Gerçekçi grafik**: dinamik gökyüzü, gün/gece döngüsü (10 dk), yumuşak gölgeler, bloom, yansımalı cam ve araba boyası, dalgalı okyanus shader'ı, yıldızlar, sokak lambası ışık havuzları
- **Araçlar**: sedan, spor, SUV, taksi, polis — drift (el freni), rampa atlayışları, hasar, duman ve patlama
- **Trafik ve yayalar**: kavşaklarda dönen yapay zekâ trafik, kaldırımda yürüyen ve panikleyip kaçan yayalar
- **Aranma sistemi (1–5 yıldız)**: polis arabaları seni yol ağında takip eder, ateş eder, yakalayabilir
- **Görevler**: zamana karşı işarete ulaş, para kazan · Yerdeki paraları topla
- **Mini harita, para, can/zırh, hız göstergesi**, sentezlenmiş ses (motor, siren, silah, patlama)

## Kontroller
| | Mobil | PC |
|---|---|---|
| Hareket / sürüş | Sol joystick (+ GAZ / FREN) | WASD / ok tuşları |
| Kamera | Ekranın sağını kaydır | Fare (tıkla → kilitle) |
| Ateş | ATEŞ | Sol tık |
| Araca bin / in | 🚗 | F |
| Zıpla / el freni | ZIPLA / EL FRENİ | Space |
| Koş | Joystick'i sonuna kadar it | Shift |

## Nasıl oynanır
**Telefonda:** Repo ayarlarından *Settings → Pages → Branch* seçip GitHub Pages'i aç, verilen linki telefonda aç,
"Ana ekrana ekle" ile uygulama gibi tam ekran oyna. Telefonu yatay tut.

**Bilgisayarda:**
```bash
python3 -m http.server 8000
```
sonra `http://localhost:8000` adresini aç. (Dosyayı çift tıklayarak açmak modüller nedeniyle çalışmaz.)

Yavaş telefonlarda başlangıç ekranından **Grafik: Düşük** seç.

## Dosyalar
- `index.html`, `style.css` — arayüz ve dokunmatik kontroller
- `main.js` — oyun motoru (şehir üretimi, fizik, yapay zekâ, efektler)
- `lib/three` — Three.js r160 (MIT lisansı), internetsiz çalışması için dahil
