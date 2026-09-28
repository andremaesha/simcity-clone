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

1. Bangun **jalan** (tool Road, drag untuk membuat jalur berbentuk L).
2. **Zone** lahan di dekat jalan: Residential (hijau), Commercial (biru), Industrial (kuning). Zona harus berada maksimal 3 tile dari jalan.
3. Bangunan tumbuh sendiri kalau ada demand. Lihat bar **R/C/I** di atas:
   - Residential butuh lapangan kerja
   - Commercial butuh penduduk
   - Industry butuh pekerja (dan punya demand ekspor dasar)
4. Kota yang makin besar membuka bangunan level lebih tinggi: rumah, lalu apartemen, lalu menara. Level 3 dan 4 butuh lingkungan yang padat dan akses langsung ke jalan.

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
    save.ts          serialisasi save/load
  engine/            rendering Three.js
    chunkManager.ts  map dipecah per 16x16 tile, satu mesh per chunk
    tileMesher.ts    tanah, air, jalan, pohon
    buildingMesher.ts bangunan prosedural per zona & level
    materials.ts     shader jendela prosedural
    cameraController.ts kamera city-builder
  ui/                HUD, toolbar, panel info, minimap, dialog (HTML/CSS)
```

## Roadmap

- [x] **Fase 1:** map 3D, kamera, jalan, zona R/C/I yang tumbuh, save/load
- [ ] **Fase 2:** listrik & air (pembangkit, jaringan kabel & pipa)
- [ ] **Fase 3:** ekonomi: pajak per zona, anggaran, biaya perawatan, grafik
- [ ] **Fase 4:** layanan (polisi, pemadam, sekolah, taman), polusi, kriminalitas, bencana
