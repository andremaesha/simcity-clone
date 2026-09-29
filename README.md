# SimCity Clone

Game city-builder 3D berbasis web, terinspirasi SimCity. Dibuat dengan **TypeScript + Vite + Three.js**. Semua grafis (bangunan, pohon, jalan) digenerate lewat kode, jadi tidak butuh file aset.

## Menjalankan

```bash
npm install
npm run dev        # buka http://localhost:5173
npm test           # unit test simulasi
npm run build      # build produksi ke dist/
```

## Cara main

1. Setiap peta punya **highway** yang melintas dari tepi ke tepi. Semua warga baru, pekerja, dan barang datang lewat highway ini, dan highway tidak bisa dihancurkan.
2. Bangun **jalan** (tool Road, drag untuk membuat jalur berbentuk L) yang **tersambung ke highway**. Jalan yang tidak tersambung tidak akan didatangi siapa pun.
3. **Zone** lahan di dekat jalan: Residential (hijau), Commercial (biru), Industrial (kuning). Zona harus berada maksimal 3 tile dari jalan.
4. Bangunan tumbuh sendiri kalau ada demand. Lihat bar **R/C/I** di atas:
   - Residential butuh lapangan kerja
   - Commercial butuh penduduk
   - Industry butuh pekerja (dan punya demand ekspor dasar)
5. Kota yang makin besar membuka bangunan level lebih tinggi: rumah, lalu apartemen, lalu menara. Level 3 dan 4 butuh lingkungan yang padat dan akses langsung ke jalan.

### Kontrol

| Input | Aksi |
| --- | --- |
| Drag kiri | Pakai tool yang dipilih |
| Drag kanan | Geser kamera |
| Drag tengah / Alt + drag | Putar & miringkan kamera |
| Scroll | Zoom ke arah kursor |
| W A S D / panah | Geser kamera (tahan Shift untuk lebih cepat) |
| Q / E, R / F | Putar, miringkan |
| 1 – 7 | Pilih tool |
| Space | Pause / lanjut |
| G | Tampilkan grid |
| Ctrl + S | Simpan |
| ` (backtick) | Tampilkan statistik performa (FPS, resolusi, draw call) |

Kota tersimpan di `localStorage` browser, dengan autosave tiap 2 menit.

### Kota yang hidup

- **Van pindahan** datang dari highway ke setiap rumah baru, dan truk mengantar ke toko serta pabrik yang baru jadi.
- **Mobil** warga benar-benar mencari rute (pathfinding): berangkat kerja, pulang, belanja, dan keluar kota. **Truk barang** bolak-balik antara industri, toko, dan highway. Jumlah kendaraan mengikuti populasi.
- **Lalu lintas highway** tetap jalan walaupun kotanya belum ada.
- **Pejalan kaki** berjalan di trotoar. Mereka hanya muncul saat kamera di-zoom dekat, supaya ringan.
- Kemacetan saat ini hanya visual: mobil mengantre, tapi tidak memengaruhi simulasi.

## Struktur kode

```
src/
  config.ts          semua angka tuning (biaya, kecepatan, ukuran map)
  game.ts            penghubung sim + render + input + UI, dan frame loop
  sim/               logika murni TypeScript (tanpa Three.js, bisa dites)
    world.ts         grid tile (struct-of-arrays) + antrean dirty tile
    mapgen.ts        generator danau, sungai, hutan
    tools.ts         perencanaan & eksekusi tool (jalan, zona, bulldoze)
    growth.ts        pertumbuhan zona, level bangunan, migration budget
    demand.ts        rumus demand RCI & kapasitas bangunan
    simulation.ts    tick, tanggal, uang, milestone
    roadNetwork.ts   graf jalan berarah (highway satu arah) + pathfinding
    frontage.ts      arah hadap bangunan & jalan depannya
    save.ts          serialisasi save/load (v2, save lama otomatis diberi highway)
  engine/            rendering Three.js
    chunkManager.ts  map dipecah per 16x16 tile, satu mesh per chunk
    tileMesher.ts    tanah, air, jalan, pohon
    buildingMesher.ts bangunan prosedural per zona & level
    materials.ts     shader jendela prosedural
    cameraController.ts kamera city-builder
    agents/          mobil, truk, van pindahan & pejalan kaki (instanced, jalur Bézier)
  ui/                HUD, toolbar, panel info, minimap, dialog (HTML/CSS)
```

## Roadmap

- [x] **Fase 1:** map 3D, kamera, jalan, zona R/C/I yang tumbuh, save/load
- [x] **Kota hidup:** highway sebagai pintu masuk kota, lalu lintas dengan rute nyata, pejalan kaki
- [ ] **Fase 2:** listrik & air (pembangkit, jaringan kabel & pipa)
- [ ] **Fase 3:** ekonomi: pajak per zona, anggaran, biaya perawatan, grafik
- [ ] **Fase 4:** layanan (polisi, pemadam, sekolah, taman), polusi, kriminalitas, bencana
