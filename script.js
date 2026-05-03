/**
 * ============================================================
 * BellMaster — Sistem Bell Sekolah Otomatis
 * script.js — Logic utama, scheduler, dan manajemen data
 * ============================================================
 */

'use strict';

/* ============================================================
   KONSTANTA & KONFIGURASI
============================================================ */
const API_URL = '/api';

/** Suara default yang tersedia (gunakan Web Audio API untuk generate tone) */
const DEFAULT_SOUNDS = [
  { id: 'masuk',      label: 'Bell Masuk',      color: '#2ecc71' },
  { id: 'istirahat',  label: 'Bell Istirahat',   color: '#f5a623' },
  { id: 'pulang',     label: 'Bell Pulang',      color: '#3d9be9' },
  { id: 'emergency',  label: 'Bell Darurat',     color: '#e74c3c' },
];

/** Daftar hari */
const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

/** Nama hari JS (0=Minggu, 1=Senin, dst.) ke nama Indonesia */
const JS_DAY_TO_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/* ============================================================
   STATE APLIKASI
============================================================ */

let appState = {
  schedules:    [],    // Array jadwal bell
  customSounds: [],    // Array suara kustom { id, name, dataUrl }
  log:          [],    // Log aktivitas
  lastRung:     {},    // { "Senin_07:00": timestamp } — mencegah bell berbunyi 2x
  filterDay:        'all',        // Filter hari aktif
  editingId:        null,         // ID jadwal yang sedang diedit
  audioUnlocked:    false,        // Flag apakah audio sudah di-unlock (setelah klik welcome)
  emergencySoundId: 'emergency',  // Suara yang digunakan tombol Bell Darurat
};

/** AudioContext global untuk Web Audio API */
let audioCtx = null;

/* ============================================================
   UTILITY: BACKEND COMMUNICATION
============================================================ */

async function loadFromBackend() {
    try {
        const [schedRes, soundRes, logRes, settingRes] = await Promise.all([
            fetch(`${API_URL}/schedules`),
            fetch(`${API_URL}/sounds`),
            fetch(`${API_URL}/logs`),
            fetch(`${API_URL}/settings`)
        ]);

        if (schedRes.ok) appState.schedules = await schedRes.json();
        if (soundRes.ok) appState.customSounds = await soundRes.json();
        if (logRes.ok) appState.log = await logRes.json();
        
        if (settingRes.ok) {
            const settings = await settingRes.json();
            if (settings.emergency_sound_id) {
                appState.emergencySoundId = settings.emergency_sound_id;
            }
        }
    } catch (e) {
        console.error('[BellMaster] Error loading from backend:', e);
        showToast('Gagal memuat data dari server', 'error');
    }
}

async function saveSettingToBackend(key, value) {
    try {
        await fetch(`${API_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
    } catch (e) {
        console.error('Error saving setting:', e);
    }
}

/* ============================================================
   UTILITY: ID Generator
============================================================ */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ============================================================
   UTILITY: Format Waktu & Tanggal
============================================================ */

/** Format Date ke HH:MM:SS */
function formatTime(date) {
  const h  = String(date.getHours()).padStart(2, '0');
  const m  = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Format Date ke HH:MM */
function formatTimeShort(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Format Date ke "Senin, 1 Jan 2024" */
function formatDateLong(date) {
  const day  = JS_DAY_TO_ID[date.getDay()];
  const d    = date.getDate();
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const mon  = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}, ${d} ${mon} ${year}`;
}

/* ============================================================
   AUDIO ENGINE — Web Audio API (generate beep) + MP3 custom
============================================================ */

/**
 * Inisialisasi AudioContext setelah interaksi pengguna.
 * Browser modern melarang autoplay tanpa interaksi terlebih dahulu.
 */
function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume jika suspended (Chrome policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

/**
 * Generate beep menggunakan Web Audio API.
 * Setiap jenis bell menghasilkan pola nada berbeda.
 * @param {string} type - 'masuk' | 'istirahat' | 'pulang' | 'emergency'
 */
function playGeneratedBell(type) {
  if (!audioCtx) return;

  const ctx = audioCtx;
  const now = ctx.currentTime;

  /** Helper: buat satu beep sederhana */
  function beep(freq, start, duration, vol = 0.5) {
    const osc   = ctx.createOscillator();
    const gain  = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type      = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Pola bunyi berbeda per jenis bell */
  switch (type) {
    case 'masuk':
      // Nada naik: Do-Mi-Sol (selamat datang)
      beep(523.25, now,       0.35, 0.5);
      beep(659.25, now + 0.4, 0.35, 0.5);
      beep(783.99, now + 0.8, 0.5,  0.6);
      break;

    case 'istirahat':
      // 3 beep pendek
      beep(440, now,       0.2, 0.4);
      beep(440, now + 0.3, 0.2, 0.4);
      beep(440, now + 0.6, 0.4, 0.5);
      break;

    case 'pulang':
      // Nada turun: Sol-Mi-Do (selamat jalan)
      beep(783.99, now,       0.35, 0.6);
      beep(659.25, now + 0.4, 0.35, 0.5);
      beep(523.25, now + 0.8, 0.7,  0.5);
      break;

    case 'emergency':
      // Alarm cepat berulang dengan nada bergantian
      for (let i = 0; i < 8; i++) {
        const freq = i % 2 === 0 ? 880 : 1100;
        beep(freq, now + i * 0.18, 0.15, 0.7);
      }
      break;

    default:
      // Default: 1 beep
      beep(660, now, 0.5, 0.5);
  }
}

/**
 * Putar suara berdasarkan ID.
 * Cek apakah ID adalah custom sound (pakai dataUrl/path) atau default (generate).
 * @param {string} soundId
 */
function playSound(soundId) {
  if (!audioCtx) {
    console.warn('[BellMaster] AudioContext belum diinisialisasi.');
    return;
  }

  // Cek apakah custom sound
  const custom = appState.customSounds.find(s => s.id === soundId);
  if (custom && custom.path) {
    const audio = document.getElementById('audio-player');
    audio.src = `/uploads/${custom.path}`;
    audio.play().catch(e => console.warn('[BellMaster] Gagal memutar audio:', e));
    return;
  }

  // Default: generate dengan Web Audio API
  const defaultSound = DEFAULT_SOUNDS.find(s => s.id === soundId);
  if (defaultSound) {
    playGeneratedBell(soundId);
    return;
  }

  // Fallback: jika tidak ditemukan, pakai masuk
  playGeneratedBell('masuk');
}

/* ============================================================
   SCHEDULER — Cek jadwal setiap detik
============================================================ */

/** Interval ID scheduler */
let schedulerInterval = null;

/** Jalankan scheduler */
function startScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(checkSchedules, 1000);
  console.log('[BellMaster] Scheduler aktif.');
}

/**
 * Periksa jadwal yang cocok dengan waktu sekarang.
 * Menggunakan flag lastRung untuk mencegah bell berbunyi 2x dalam 1 menit.
 */
function checkSchedules() {
  const now      = new Date();
  const nowDay   = JS_DAY_TO_ID[now.getDay()];           // "Senin" dst.
  const nowTime  = formatTimeShort(now);                  // "07:00"
  const flagKey  = `${nowDay}_${nowTime}`;               // "Senin_07:00"

  // Jika menit ini sudah pernah dibunyikan, lewati
  if (appState.lastRung[flagKey] && (Date.now() - appState.lastRung[flagKey]) < 60000) {
    return;
  }

  // Cari jadwal yang cocok
  const matched = appState.schedules.filter(s =>
    s.day === nowDay && s.time === nowTime
  );

  matched.forEach(schedule => {
    // Tandai sudah dibunyikan
    appState.lastRung[flagKey] = Date.now();

    console.log(`[BellMaster] Bell berbunyi: ${schedule.name} (${schedule.time})`);

    // Bunyikan bell
    playSound(schedule.soundId);

    // Animasi item yang berbunyi
    highlightScheduleItem(schedule.id);

    // Tambah ke log
    addLog(`Bell "${schedule.name}" berbunyi`, 'scheduled');

    // Tampilkan toast notifikasi
    showToast(`🔔 Bell: ${schedule.name} — ${schedule.time}`, 'info');
  });
}

/** Animasi highlight item jadwal yang berbunyi */
function highlightScheduleItem(id) {
  const el = document.querySelector(`.schedule-item[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('ringing');
  setTimeout(() => el.classList.remove('ringing'), 3500);
}

/* ============================================================
   JAM LIVE (Header)
============================================================ */

function startLiveClock() {
  function tick() {
    const now = new Date();
    document.getElementById('live-clock').textContent = formatTime(now);
    document.getElementById('live-day').textContent   = formatDateLong(now);
  }
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
   RENDER JADWAL
============================================================ */

/** Render daftar jadwal ke DOM */
function renderSchedules() {
  const list     = document.getElementById('schedule-list');
  const emptyEl  = document.getElementById('empty-state');

  // Filter berdasarkan hari aktif
  let filtered = appState.schedules;
  if (appState.filterDay !== 'all') {
    filtered = filtered.filter(s => s.day === appState.filterDay);
  }

  // Urutkan: hari lalu jam
  filtered.sort((a, b) => {
    const dayDiff = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    return a.time.localeCompare(b.time);
  });

  // Hapus semua item (kecuali empty-state)
  Array.from(list.querySelectorAll('.schedule-item')).forEach(el => el.remove());

  if (filtered.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  filtered.forEach(schedule => {
    const soundLabel = getSoundLabel(schedule.soundId);
    const item = document.createElement('div');
    item.className = 'schedule-item';
    item.dataset.id = schedule.id;
    item.innerHTML = `
      <div class="item-time">${schedule.time}</div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(schedule.name)}</div>
        <div class="item-meta">
          <span class="item-day">${schedule.day}</span>
          <span class="item-sound">${escapeHtml(soundLabel)}</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn-icon btn-play" title="Pratinjau suara" data-sound="${schedule.soundId}">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        </button>
        <button class="btn-icon btn-edit" title="Edit jadwal" data-id="${schedule.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete btn-icon" title="Hapus jadwal" data-id="${schedule.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    `;

    // Event: pratinjau suara
    item.querySelector('.btn-play').addEventListener('click', e => {
      e.stopPropagation();
      playSound(e.currentTarget.dataset.sound);
    });

    // Event: edit
    item.querySelector('.btn-edit').addEventListener('click', e => {
      e.stopPropagation();
      openEditForm(e.currentTarget.dataset.id);
    });

    // Event: hapus
    item.querySelector('.btn-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteSchedule(e.currentTarget.dataset.id);
    });

    list.appendChild(item);
  });
}

/** Escape HTML untuk mencegah XSS */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Dapatkan label suara berdasarkan ID */
function getSoundLabel(soundId) {
  const def = DEFAULT_SOUNDS.find(s => s.id === soundId);
  if (def) return def.label;
  const cust = appState.customSounds.find(s => s.id === soundId);
  if (cust) return cust.name;
  return soundId;
}

/* ============================================================
   FORM: TAMBAH / EDIT JADWAL
============================================================ */

/** Isi dropdown pilihan suara di form */
function populateSoundOptions() {
  const sel = document.getElementById('f-sound');
  sel.innerHTML = '';

  // Grup suara default
  const groupDefault = document.createElement('optgroup');
  groupDefault.label = 'Suara Default (Generated)';
  DEFAULT_SOUNDS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    groupDefault.appendChild(opt);
  });
  sel.appendChild(groupDefault);

  // Grup suara kustom
  if (appState.customSounds.length > 0) {
    const groupCustom = document.createElement('optgroup');
    groupCustom.label = 'Suara Kustom';
    appState.customSounds.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      groupCustom.appendChild(opt);
    });
    sel.appendChild(groupCustom);
  }
}

/** Buka form tambah jadwal baru */
function openAddForm() {
  appState.editingId = null;
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = 'Tambah Jadwal';
  document.getElementById('f-day').value   = 'Senin';
  document.getElementById('f-time').value  = '';
  document.getElementById('f-name').value  = '';
  document.getElementById('f-sound').value = 'masuk';
  populateSoundOptions();
  showFormPanel();
}

/** Buka form edit jadwal */
function openEditForm(id) {
  const schedule = appState.schedules.find(s => s.id === id);
  if (!schedule) return;

  appState.editingId = id;
  populateSoundOptions();

  document.getElementById('edit-id').value  = id;
  document.getElementById('form-title').textContent = 'Edit Jadwal';
  document.getElementById('f-day').value    = schedule.day;
  document.getElementById('f-time').value   = schedule.time;
  document.getElementById('f-name').value   = schedule.name;
  document.getElementById('f-sound').value  = schedule.soundId;

  showFormPanel();
}

/** Tampilkan panel form */
function showFormPanel() {
  const panel = document.getElementById('form-panel');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Sembunyikan panel form */
function hideFormPanel() {
  document.getElementById('form-panel').classList.add('hidden');
  appState.editingId = null;
}

/** Simpan jadwal (tambah atau edit) */
async function saveSchedule() {
  const day     = document.getElementById('f-day').value.trim();
  const time    = document.getElementById('f-time').value.trim();
  const name    = document.getElementById('f-name').value.trim();
  const soundId = document.getElementById('f-sound').value;

  // Validasi
  if (!time) { showToast('Jam wajib diisi.', 'error'); return; }
  if (!name) { showToast('Nama kegiatan wajib diisi.', 'error'); return; }

  try {
      if (appState.editingId) {
        // Mode edit
        const payload = { day, time, name, soundId };
        const res = await fetch(`${API_URL}/schedules/${appState.editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            const idx = appState.schedules.findIndex(s => s.id === appState.editingId);
            if (idx !== -1) {
              appState.schedules[idx] = { ...appState.schedules[idx], day, time, name, soundId };
            }
            showToast('Jadwal berhasil diperbarui.', 'success');
            addLog(`Jadwal "${name}" diperbarui`, 'info');
        }
      } else {
        // Mode tambah
        const id = generateId();
        const payload = { id, day, time, name, soundId };
        const res = await fetch(`${API_URL}/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            appState.schedules.push(payload);
            showToast('Jadwal berhasil ditambahkan.', 'success');
            addLog(`Jadwal "${name}" ditambahkan (${day} ${time})`, 'info');
        }
      }

      renderSchedules();
      hideFormPanel();
  } catch (error) {
      console.error(error);
      showToast('Gagal menyimpan jadwal', 'error');
  }
}

/** Hapus jadwal berdasarkan ID */
async function deleteSchedule(id) {
  const schedule = appState.schedules.find(s => s.id === id);
  if (!schedule) return;

  if (!confirm(`Hapus jadwal "${schedule.name}" pada ${schedule.day} ${schedule.time}?`)) return;

  try {
      const res = await fetch(`${API_URL}/schedules/${id}`, { method: 'DELETE' });
      if (res.ok) {
          appState.schedules = appState.schedules.filter(s => s.id !== id);
          renderSchedules();
          showToast('Jadwal dihapus.', 'success');
          addLog(`Jadwal "${schedule.name}" dihapus`, 'info');
      }
  } catch (error) {
      console.error(error);
      showToast('Gagal menghapus jadwal', 'error');
  }
}

/* ============================================================
   CUSTOM SOUND UPLOAD
============================================================ */

/**
 * Proses file audio yang diupload.
 * Dikirim ke backend menggunakan FormData.
 */
async function handleFileUpload(file) {
  if (!file) return;
  if (!file.type.match(/audio\/(mp3|mpeg)/)) {
    showToast('Hanya file MP3 yang didukung.', 'error');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showToast('Ukuran file maksimal 4MB.', 'error');
    return;
  }

  const name = file.name.replace(/\.[^.]+$/, '');
  const soundId = generateId();

  const formData = new FormData();
  formData.append('soundFile', file);
  formData.append('id', soundId);
  formData.append('name', name);

  try {
      showToast('Mengunggah...', 'info');
      const res = await fetch(`${API_URL}/sounds`, {
          method: 'POST',
          body: formData
      });

      if (res.ok) {
          const newSound = await res.json();
          appState.customSounds.push(newSound);

          populateSoundOptions();
          document.getElementById('f-sound').value = soundId;
          populateEmergencySoundOptions();
          renderCustomSoundList();
          showToast(`Suara "${name}" berhasil diunggah.`, 'success');
          addLog(`Suara kustom "${name}" diunggah`, 'info');
      } else {
          showToast('Gagal mengunggah suara', 'error');
      }
  } catch (error) {
      console.error(error);
      showToast('Error saat mengunggah', 'error');
  }
}

/** Render daftar suara kustom */
function renderCustomSoundList() {
  const container = document.getElementById('custom-sound-list');
  container.innerHTML = '';

  if (appState.customSounds.length === 0) {
    container.innerHTML = '<p class="no-custom">Belum ada suara kustom yang diunggah.</p>';
    return;
  }

  appState.customSounds.forEach(sound => {
    const item = document.createElement('div');
    item.className = 'custom-sound-item';
    item.innerHTML = `
      <span class="custom-sound-name">♪ ${escapeHtml(sound.name)}</span>
      <div style="display:flex;gap:0.4rem;flex-shrink:0;">
        <button class="btn-icon btn-play" title="Putar" data-sound="${sound.id}">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        </button>
        <button class="btn-icon btn-delete" title="Hapus suara" data-id="${sound.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </div>
    `;

    item.querySelector('.btn-play').addEventListener('click', e => {
      playSound(e.currentTarget.dataset.sound);
    });

    item.querySelector('.btn-delete').addEventListener('click', e => {
      deleteCustomSound(e.currentTarget.dataset.id);
    });

    container.appendChild(item);
  });
}

/** Hapus suara kustom */
async function deleteCustomSound(id) {
  const sound = appState.customSounds.find(s => s.id === id);
  if (!sound) return;
  if (!confirm(`Hapus suara "${sound.name}"? Jadwal yang menggunakan suara ini akan menggunakan suara default.`)) return;

  try {
      const res = await fetch(`${API_URL}/sounds/${id}`, { method: 'DELETE' });
      if (res.ok) {
          appState.customSounds = appState.customSounds.filter(s => s.id !== id);

          // Jadwal yang pakai suara ini -> fallback ke masuk
          appState.schedules.forEach(s => {
            if (s.soundId === id) {
                s.soundId = 'masuk';
                fetch(`${API_URL}/schedules/${s.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(s)
                });
            }
          });

          // Jika suara darurat aktif dihapus -> fallback ke default emergency
          if (appState.emergencySoundId === id) {
            appState.emergencySoundId = 'emergency';
            saveSettingToBackend('emergency_sound_id', 'emergency');
            showToast('Suara darurat direset ke default karena suara dihapus.', 'info');
          }

          populateSoundOptions();
          populateEmergencySoundOptions();
          renderCustomSoundList();
          renderSchedules();
          showToast(`Suara "${sound.name}" dihapus.`, 'success');
      }
  } catch (error) {
      console.error(error);
      showToast('Gagal menghapus suara', 'error');
  }
}

/* ============================================================
   EMERGENCY BELL
============================================================ */

/**
 * Upload MP3 khusus untuk Bell Darurat.
 */
async function handleEmergencyUpload(file) {
  if (!file) return;
  if (!file.type.match(/audio\/(mp3|mpeg)/)) {
    showToast('Hanya file MP3 yang didukung.', 'error');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showToast('Ukuran file maksimal 4MB.', 'error');
    return;
  }

  const name = file.name.replace(/\.[^.]+$/, '');
  const soundId = generateId();

  const formData = new FormData();
  formData.append('soundFile', file);
  formData.append('id', soundId);
  formData.append('name', name);

  try {
      showToast('Mengunggah...', 'info');
      const res = await fetch(`${API_URL}/sounds`, {
          method: 'POST',
          body: formData
      });

      if (res.ok) {
          const newSound = await res.json();
          appState.customSounds.push(newSound);

          // Langsung set sebagai suara darurat aktif
          appState.emergencySoundId = soundId;
          await saveSettingToBackend('emergency_sound_id', soundId);

          populateSoundOptions();
          populateEmergencySoundOptions();
          renderCustomSoundList();
          showToast(`✓ Suara darurat diubah ke "${name}"`, 'success');
          addLog(`Suara darurat kustom "${name}" diunggah & diaktifkan`, 'emergency');
      }
  } catch (error) {
      console.error(error);
      showToast('Error saat mengunggah', 'error');
  }
}

function fireEmergencyBell() {
  const btn = document.getElementById('btn-emergency');

  // Animasi tombol
  btn.classList.add('firing');
  setTimeout(() => btn.classList.remove('firing'), 1700);

  // Putar suara yang dipilih untuk darurat
  playSound(appState.emergencySoundId);

  // Log waktu + nama suara di panel emergency
  const now       = new Date();
  const soundLabel = getSoundLabel(appState.emergencySoundId);
  const logEl     = document.getElementById('emergency-log');
  logEl.textContent = `Terakhir: ${formatTime(now)} · ${soundLabel}`;

  // Tambah ke log aktivitas
  addLog(`Bell Darurat dibunyikan (${soundLabel})`, 'emergency');

  showToast(`⚠ Bell Darurat: ${soundLabel}`, 'error');
}

/**
 * Isi dropdown pilihan suara di panel Emergency.
 */
function populateEmergencySoundOptions() {
  const sel = document.getElementById('emergency-sound-select');
  if (!sel) return;

  sel.innerHTML = '';

  // Grup default
  const groupDefault = document.createElement('optgroup');
  groupDefault.label = 'Suara Default';
  DEFAULT_SOUNDS.forEach(s => {
    const opt = document.createElement('option');
    opt.value       = s.id;
    opt.textContent = s.label;
    groupDefault.appendChild(opt);
  });
  sel.appendChild(groupDefault);

  // Grup kustom
  if (appState.customSounds.length > 0) {
    const groupCustom = document.createElement('optgroup');
    groupCustom.label = 'Suara Kustom';
    appState.customSounds.forEach(s => {
      const opt = document.createElement('option');
      opt.value       = s.id;
      opt.textContent = '♪ ' + s.name;
      groupCustom.appendChild(opt);
    });
    sel.appendChild(groupCustom);
  }

  // Pilih nilai yang tersimpan
  sel.value = appState.emergencySoundId || 'emergency';
}

/**
 * Tambah entri ke log aktivitas.
 * @param {string} message - Pesan log
 * @param {string} type - 'scheduled' | 'emergency' | 'info'
 */
async function addLog(message, type = 'info') {
  const now = new Date();
  const entry = {
    message,
    type,
    time: formatTime(now),
    date: formatDateLong(now),
    ts:   now.getTime(),
  };

  try {
      await fetch(`${API_URL}/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry)
      });
      
      appState.log.unshift(entry); // Tambah di depan (terbaru di atas)
      if (appState.log.length > 50) appState.log.pop(); // Batasi 50
      
      renderLog();
  } catch (error) {
      console.error(error);
  }
}

/** Render log aktivitas ke DOM */
function renderLog() {
  const container = document.getElementById('activity-log');
  container.innerHTML = '';

  if (appState.log.length === 0) {
    container.innerHTML = '<p class="log-empty">Belum ada aktivitas.</p>';
    return;
  }

  appState.log.forEach(entry => {
    const item = document.createElement('div');
    item.className = `log-item type-${entry.type}`;
    item.innerHTML = `
      <span class="log-time">${entry.time}</span>
      <span>${escapeHtml(entry.message)}</span>
    `;
    container.appendChild(item);
  });
}

/** Hapus semua log */
async function clearLog() {
  if (!confirm('Hapus semua log aktivitas?')) return;
  try {
      const res = await fetch(`${API_URL}/logs`, { method: 'DELETE' });
      if (res.ok) {
          appState.log = [];
          renderLog();
      }
  } catch (error) {
      console.error(error);
      showToast('Gagal menghapus log', 'error');
  }
}

/* ============================================================
   TOAST NOTIFICATION
============================================================ */

let toastTimer = null;

/**
 * Tampilkan notifikasi toast sementara.
 */
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/* ============================================================
   FILTER HARI
============================================================ */

function initDayFilter() {
  const container = document.getElementById('day-filter');
  container.addEventListener('click', e => {
    const btn = e.target.closest('.day-btn');
    if (!btn) return;

    // Hapus active dari semua
    container.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    appState.filterDay = btn.dataset.day;
    renderSchedules();
  });
}

/* ============================================================
   WELCOME SCREEN → DASHBOARD
============================================================ */

function initWelcomeScreen() {
  const btnEnter    = document.getElementById('btn-enter');
  const welcomeEl   = document.getElementById('welcome-screen');
  const dashboardEl = document.getElementById('dashboard');

  btnEnter.addEventListener('click', () => {
    // KRITIS: Inisialisasi AudioContext hanya bisa dilakukan setelah interaksi user
    initAudioContext();
    appState.audioUnlocked = true;

    // Animasi transisi
    welcomeEl.style.opacity = '0';
    welcomeEl.style.transform = 'scale(0.97)';
    welcomeEl.style.transition = 'opacity 0.5s ease, transform 0.5s ease';

    setTimeout(() => {
      welcomeEl.classList.add('hidden');
      dashboardEl.classList.remove('hidden');

      // Tampilkan dashboard dengan animasi
      dashboardEl.style.opacity = '0';
      requestAnimationFrame(() => {
        dashboardEl.style.transition = 'opacity 0.4s ease';
        dashboardEl.style.opacity = '1';
      });

      // Mulai semua sistem
      startLiveClock();
      startScheduler();
      addLog('Sistem BellMaster diaktifkan', 'info');
      showToast('✓ Sistem aktif. Bell akan berbunyi otomatis sesuai jadwal.', 'success', 4000);
    }, 500);
  });
}

/* ============================================================
   INISIALISASI EVENT LISTENER
============================================================ */

function initEventListeners() {
  // Tombol buka form tambah
  document.getElementById('btn-add-open').addEventListener('click', openAddForm);

  // Tombol tutup form
  document.getElementById('btn-form-close').addEventListener('click', hideFormPanel);
  document.getElementById('btn-cancel').addEventListener('click', hideFormPanel);

  // Tombol simpan jadwal
  document.getElementById('btn-save').addEventListener('click', saveSchedule);

  // Pratinjau suara dari form
  document.getElementById('btn-preview-sound').addEventListener('click', () => {
    const soundId = document.getElementById('f-sound').value;
    if (!appState.audioUnlocked) {
      showToast('Klik "Aktifkan Sistem" terlebih dahulu.', 'error');
      return;
    }
    playSound(soundId);
  });

  // Upload suara
  const uploadInput = document.getElementById('f-upload');
  uploadInput.addEventListener('change', e => {
    handleFileUpload(e.target.files[0]);
    uploadInput.value = ''; // Reset agar bisa upload file sama lagi
  });

  // Drag & drop pada upload area
  const uploadArea = document.getElementById('upload-area');
  uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  });

  // Emergency bell
  document.getElementById('btn-emergency').addEventListener('click', () => {
    if (!appState.audioUnlocked) {
      showToast('Klik "Aktifkan Sistem" terlebih dahulu.', 'error');
      return;
    }
    fireEmergencyBell();
  });

  // Dropdown pilihan suara darurat
  document.getElementById('emergency-sound-select').addEventListener('change', e => {
    appState.emergencySoundId = e.target.value;
    saveSettingToBackend('emergency_sound_id', e.target.value);
    const label = getSoundLabel(appState.emergencySoundId);
    showToast(`Suara darurat diubah: ${label}`, 'info');
  });

  // Pratinjau suara darurat
  document.getElementById('btn-preview-emergency').addEventListener('click', () => {
    if (!appState.audioUnlocked) {
      showToast('Klik "Aktifkan Sistem" terlebih dahulu.', 'error');
      return;
    }
    playSound(appState.emergencySoundId);
  });

  // Upload MP3 langsung dari panel darurat
  const emergencyUploadInput = document.getElementById('emergency-upload');
  emergencyUploadInput.addEventListener('change', e => {
    handleEmergencyUpload(e.target.files[0]);
    emergencyUploadInput.value = '';
  });

  // Drag & drop upload area darurat
  const emergencyUploadArea = document.getElementById('emergency-upload-area');
  emergencyUploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    emergencyUploadArea.classList.add('drag-over');
  });
  emergencyUploadArea.addEventListener('dragleave', () => emergencyUploadArea.classList.remove('drag-over'));
  emergencyUploadArea.addEventListener('drop', e => {
    e.preventDefault();
    emergencyUploadArea.classList.remove('drag-over');
    handleEmergencyUpload(e.dataTransfer.files[0]);
  });

  // Hapus log
  document.getElementById('btn-clear-log').addEventListener('click', clearLog);

  // Keyboard shortcut: Enter di input form → simpan
  document.getElementById('f-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveSchedule();
  });
}

/* ============================================================
   INISIALISASI UTAMA
============================================================ */

async function init() {
  // Muat data dari Backend API
  await loadFromBackend();

  // Setup welcome screen
  initWelcomeScreen();

  // Setup day filter
  initDayFilter();

  // Setup event listener
  initEventListeners();

  // Isi form dropdown & render awal (sebelum masuk dashboard)
  populateSoundOptions();
  populateEmergencySoundOptions();
  renderSchedules();
  renderCustomSoundList();
  renderLog();

  // Sembunyikan form panel saat pertama kali
  hideFormPanel();

  console.log('[BellMaster] Aplikasi berhasil diinisialisasi.');
  console.log(`[BellMaster] Jadwal tersimpan: ${appState.schedules.length}`);
  console.log(`[BellMaster] Suara kustom: ${appState.customSounds.length}`);
}

/* ============================================================
   JALANKAN SETELAH DOM SIAP
============================================================ */
document.addEventListener('DOMContentLoaded', init);
