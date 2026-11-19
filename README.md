# 🌴 VISTA BAY — Açık Dünya Mobil Oyun

Güneşli bir sahil şehrinde geçen, tarayıcıda çalışan gerçekçi 3D açık dünya oyunu (Three.js).
Telefonda ve bilgisayarda çalışır, kurulum gerekmez.

## Özellikler
- **8x8 bloklu, bölgelere ayrılmış şehir**: cam gökdelenli merkez, tuğla apartmanlar (balkonlu), art deco sahil otelleri,
  kiremit çatılı evler + bahçe + havuzlu banliyö, depo ve konteynerli sanayi bölgesi, parklar
- **Sokak detayları**: çalışan trafik ışıkları (trafik kırmızıda durur), dükkan tabelaları, banklar, çöp kutuları, yangın muslukları, ağaçlar ve palmiyeler
- **Dükkanlar**: 🔫 Silah dükkanı (silah, mermi, zırh, can) ve 🚗 VISTA MOTORS galerisi (7 araç) — sahip olduğun araçlar haritada mavi
- **🔧 Garaj & Boya**: araçla mavi halkaya gir → tamir (aranma yıldızlarını da siler), 9 renk boya, motor ve fren/tutuş yükseltmesi (3 seviye), gövde zırhı, spor araba / zırhlı araç çağırma
- **🔫 Silah & Ekipman**: kırmızı halkada "MAĞAZAYI AÇ" (PC: E) → can/zırh, pompalı, taramalı tüfek, roketatar, mermi paketleri
- **Görev halkaları (sarı)**: haritada 3 görev noktası — zamana karşı yarış, araç teslimatı (polisten kaç, garaja hasarsız getir), taksi, suikast, kurye · hedef oku ve ödül ekranda
- **📱 Oyun içi telefon** (📱 butonu / PC: P veya Tab): Vale (kayıtlı aracını yolun kenarına çağır, ★ favori), Banka (bakiye, son işlemler, istatistikler, 12 başarım), Kontrat (korumalı hedef suikastı), Emlak (gelir ve GPS)
- **🏠 Emlak & pasif gelir**: Oto Yıkama, Sahil Kulübü, Lüks Villa, Gece Kulübü — yeşil halkadan satın al, her oyun saatinde otomatik gelir; mülkler kayıt noktası ve doğuş noktası olur
- **Mobil his**: titreşim (ateş, çarpışma, para, görev), yüzen joystick
- **Kayıt sistemi**: para, sahip olunan silahlar, mermiler, araçlar, renkler ve yükseltmeler otomatik kaydedilir
- **Gerçekçi grafik**: hareketli bulutlu gökyüzü, gün/gece döngüsü (16 dk), yumuşak gölgeler, sinematik renk düzenleme, zemin gölgelendirmesi, yansımalı cam ve araba boyası, okyanus shader'ı, sokak lambaları
- **Araçlar**: sedan, spor, süper araba, SUV, pikap, minibüs, taksi, polis, motosiklet — drift (el freni), rampa atlayışları, hasar, duman ve patlama
- **Trafik ve yayalar**: kavşaklarda dönen yapay zekâ trafik, kaldırımda yürüyen ve panikleyip kaçan yayalar
- **Aranma sistemi (1–5 yıldız)**: polis arabaları seni yol ağında takip eder, ateş eder, yakalayabilir
- **Silahlar**: tabanca, Uzi, saldırı tüfeği, pompalı, roketatar · Şehre dağılmış silah / can / zırh kutuları
- **Motosiklet**: virajda yatan, hızlı motorlar (sert çarpışmada uçarsın!)
- **Görevler**: işarete ulaş, 5 noktalı yarış, taksi yolcusu taşıma, hedef aracı yok etme · Yerdeki paraları topla
- **Hava durumu döngüsü**: ☀️ Güneşli → ⛅ Bulutlu → 🌧 Yağmurlu → ⛈ Fırtına (şimşek) → 🌫 Sisli; yağmurda yollar kayar ve yansır, simge saatin yanında
- **🚁 Helikopter** (parktaki ve sahildeki pistler, gökdelen çatısına inilebilir): ▲ YÜKSEL / ▼ ALÇAL (PC: Space / C)
- **🚤 Sürat teknesi**: sahildeki iskelede, dalgalarla sallanır, köpük izi bırakır
- **Çete**: sanayi bölgesindeki Kızıl Kobralar, ateş edersen veya yanlarında oyalanırsan karşılık verir
- **⚔ Bölge savaşları**: harita 4 çete bölgesine ayrılır (mini haritada renkli alanlar); bayrağa gidip 3 dalga düşmanı temizle → bölge senin olur, yeşile döner ve saatlik pasif gelir verir
- **💰 Zırhlı para kamyonu**: rastgele beliren kamyonu patlat, saçılan para balyalarını topla
- **🎒 20 gizli paket**: arka sokaklara, iskeleye, harita köşelerine ve bir gökdelen çatısına saklı; her biri +$500 ve görev ödüllerine kalıcı +%3, 5/10/15/20'de ekstra bonus
- **🏁 Stunt atlayışları**: 7 rampa (sahil + parklar); hızla atlayınca ağır çekim sinematik kamera, başarılı inişte STUNT BONUS (ilk atlayış x2)
- **Canlı şehir**: silah sesinde trafik paniğe kapılır; araç ve yayalar oyuncunun etrafında (~150-230 m) sürekli yeniden konumlanır
- **Araba radyosu**: VISTA FM 101.4 — anlık üretilen synthwave müzik (R / 📻)
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
| Silah değiştir | Silah butonu | 1-5 / X / fare tekerleği |
| Mağaza / Garaj / Mülk | Sarı buton | E |
| Telefon | 📱 | P / Tab |
| Ses (radyo → efektler → sessiz) | 📻 | R |

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
