import { useEffect, useRef, useState } from 'react';
import {
  Video, Keyboard, Settings, HelpCircle, MessageSquare, Menu, Grid,
  X, Copy, Check, Plus, CalendarPlus, Home, Mic, VideoOff,
} from 'lucide-react';
import RoomView from './components/RoomView'; // Halaman rapat
import PreJoin from './components/PreJoin'; // Halaman pra-gabung (pratinjau kamera)

// Ekstrak kode rapat dari teks: bisa berupa kode langsung ATAU link undangan
// yang ditempel utuh (mis. https://host/?room=abc-defgh-ijk)
function extractRoomCode(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return (url.searchParams.get('room') || url.searchParams.get('code') || raw).trim();
  } catch {
    return raw;
  }
}

// Membuat kode room acak, format ala Google Meet: xxx-xxxxx-xxx
const generateRoomCode = () =>
  Math.random().toString(36).substring(2, 5) + '-' +
  Math.random().toString(36).substring(2, 7) + '-' +
  Math.random().toString(36).substring(2, 5);

// Kartu modal generik di tengah layar
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl text-[#202124] font-normal">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function App() {
  // Dukungan link undangan: buka /?room=kode (atau ?code=) langsung ke pra-gabung
  const initialCode = (() => {
    const p = new URLSearchParams(window.location.search);
    return (p.get('room') || p.get('code') || '').trim();
  })();

  // Halaman: 'landing' -> 'prejoin' -> 'room'
  const [view, setView] = useState(initialCode ? 'prejoin' : 'landing');
  const [roomCode, setRoomCode] = useState(initialCode);
  const [userName, setUserName] = useState(() => localStorage.getItem('meet:userName') || "");

  // Jam & tanggal live di navbar (diperbarui tiap 10 detik)
  const [now, setNow] = useState(() => new Date());

  // Panel/modal yang sedang terbuka: null | 'drawer' | 'newMeeting' | 'laterLink'
  // | 'help' | 'feedback' | 'settings' | 'apps' | 'profile'
  const [openPanel, setOpenPanel] = useState(null);
  const [laterCode, setLaterCode] = useState("");   // Kode untuk "rapat untuk nanti"
  const [copied, setCopied] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Preferensi join (dibaca RoomView saat masuk rapat)
  const [joinMuted, setJoinMuted] = useState(() => localStorage.getItem('meet:joinMuted') === '1');
  const [joinVideoOff, setJoinVideoOff] = useState(() => localStorage.getItem('meet:joinVideoOff') === '1');

  const nameInputRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Simpan nama agar tidak perlu diketik ulang saat halaman dimuat lagi
  useEffect(() => {
    localStorage.setItem('meet:userName', userName);
  }, [userName]);

  // Dukungan link undangan sudah ditangani lewat initial state roomCode di atas

  const saveJoinPrefs = (muted, videoOff) => {
    setJoinMuted(muted);
    setJoinVideoOff(videoOff);
    localStorage.setItem('meet:joinMuted', muted ? '1' : '0');
    localStorage.setItem('meet:joinVideoOff', videoOff ? '1' : '0');
  };

  // Menuju halaman pra-gabung (pratinjau kamera) dengan kode tertentu
  const goPreJoin = (code) => {
    const clean = extractRoomCode(code);
    if (!clean) return;
    setOpenPanel(null);
    setRoomCode(clean);
    // Tampilkan kode di URL agar bisa disalin/di-refresh tanpa kehilangan room
    window.history.replaceState({}, '', `/?room=${encodeURIComponent(clean)}`);
    setView('prejoin');
  };

  // Fungsi untuk memulai rapat instan (room baru -> pra-gabung)
  const handleCreateRoom = () => goPreJoin(generateRoomCode());

  // Membuat rapat untuk nanti: hasilkan kode + tampilkan link yang bisa disalin
  const handleCreateForLater = () => {
    setLaterCode(generateRoomCode());
    setCopied(false);
    setOpenPanel('laterLink');
  };

  // Fungsi untuk bergabung ketika memasukkan kode room / link undangan
  const handleJoinRoom = () => goPreJoin(roomCode);

  // Fungsi untuk kembali ke halaman utama ketika menutup panggilan
  const handleLeaveRoom = () => {
    setView("landing");
    setRoomCode(""); // Reset kode room kembali kosong saat keluar
    // Bersihkan ?room= dari address bar agar tidak auto terisi lagi
    window.history.replaceState({}, '', window.location.pathname);
  };

  const copyLaterLink = async () => {
    const link = `${window.location.origin}/?room=${laterCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Salin link rapat ini:", link);
    }
  };

  const sendFeedback = () => {
    if (!feedbackText.trim()) return;
    console.log("Masukan pengguna:", feedbackText);
    setFeedbackText("");
    setFeedbackSent(true);
    setTimeout(() => { setFeedbackSent(false); setOpenPanel(null); }, 1500);
  };

  // Nama yang dipakai; default "Tamu" jika kosong
  const displayName = userName.trim() || "Tamu";
  const initial = displayName.charAt(0).toUpperCase();

  const timeText = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const dateText = now.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

  // CONDITIONAL RENDERING: Jika sedang dalam room, tampilkan halaman meeting video
  if (view === "room") {
    return (
      <RoomView
        roomCode={roomCode}
        userName={displayName}
        joinMuted={joinMuted}
        joinVideoOff={joinVideoOff}
        onLeave={handleLeaveRoom}
      />
    );
  }

  // Halaman pra-gabung: pratinjau kamera + konfirmasi nama sebelum masuk
  if (view === "prejoin") {
    return (
      <PreJoin
        roomCode={roomCode}
        userName={userName}
        setUserName={setUserName}
        initialMicOn={!joinMuted}
        initialCamOn={!joinVideoOff}
        onJoin={({ micOn, camOn }) => {
          saveJoinPrefs(!micOn, !camOn);
          setView("room");
        }}
        onBack={handleLeaveRoom}
      />
    );
  }

  // Kartu modal generik didefinisikan di luar komponen (lihat Modal di atas)

  // TAMPILAN UTAMA (LANDING PAGE)
  return (
    <div className="min-h-screen bg-white text-[#5f6368] flex flex-col font-sans">
      {/* --- NAVBAR --- */}
      <header className="flex items-center justify-between px-4 h-16 w-full relative z-40">
        <div className="flex items-center">
          <button
            onClick={() => setOpenPanel(openPanel === 'drawer' ? null : 'drawer')}
            className="p-3 hover:bg-gray-100 rounded-full transition"
            title="Menu utama"
          >
            <Menu className="w-6 h-6 text-[#5f6368]" />
          </button>
          <div className="flex items-center ml-2 space-x-1">
            <img
              src="https://www.gstatic.com/images/branding/googlelogo/svg/googlelogo_clr_74x24dp.svg"
              alt="Google"
              className="h-6"
            />
            <span className="text-[22px] text-[#5f6368] font-normal relative top-[1px]">Meet</span>
          </div>
        </div>

        <div className="flex items-center space-x-1 md:space-x-3">
          <div className="hidden sm:block text-[#5f6368] text-lg font-normal mr-4">
            {timeText} • {dateText}
          </div>
          <button onClick={() => setOpenPanel('help')} title="Bantuan" className="p-2.5 hover:bg-gray-100 rounded-full"><HelpCircle className="w-6 h-6" /></button>
          <button onClick={() => setOpenPanel('feedback')} title="Kirim masukan" className="p-2.5 hover:bg-gray-100 rounded-full"><MessageSquare className="w-6 h-6" /></button>
          <button onClick={() => setOpenPanel('settings')} title="Setelan" className="p-2.5 hover:bg-gray-100 rounded-full"><Settings className="w-6 h-6" /></button>

          <div className="flex items-center ml-4 space-x-2 relative">
            <button onClick={() => setOpenPanel(openPanel === 'apps' ? null : 'apps')} title="Aplikasi" className="p-2.5 hover:bg-gray-100 rounded-full"><Grid className="w-6 h-6" /></button>
            <button
              onClick={() => setOpenPanel(openPanel === 'profile' ? null : 'profile')}
              title="Akun Anda"
              className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center text-white text-sm font-medium cursor-pointer shadow-sm"
            >
              {initial}
            </button>

            {/* Popover Aplikasi */}
            {openPanel === 'apps' && (
              <div className="absolute right-0 top-12 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-56">
                <p className="text-xs text-gray-500 mb-3">Aplikasi</p>
                <button onClick={() => setOpenPanel(null)} className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-xl w-full">
                  <Video className="w-8 h-8 text-[#00832d]" />
                  <span className="text-sm text-[#202124]">Meet</span>
                </button>
              </div>
            )}

            {/* Popover Profil */}
            {openPanel === 'profile' && (
              <div className="absolute right-0 top-12 bg-white border border-gray-200 rounded-xl shadow-xl p-5 w-64 text-center">
                <div className="w-16 h-16 bg-blue-700 rounded-full flex items-center justify-center text-white text-2xl font-medium mx-auto mb-3">
                  {initial}
                </div>
                <p className="text-[#202124] font-medium">{displayName}</p>
                <p className="text-xs text-gray-500 mt-1 mb-4">Peserta tamu (tanpa akun)</p>
                <button
                  onClick={() => { setOpenPanel(null); nameInputRef.current?.focus(); }}
                  className="text-sm text-[#1a73e8] hover:bg-blue-50 px-4 py-2 rounded-full font-medium"
                >
                  Ganti nama
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* --- DRAWER MENU KIRI --- */}
      {openPanel === 'drawer' && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setOpenPanel(null)} />
          <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white z-50 shadow-2xl p-4 flex flex-col">
            <div className="flex items-center h-12 mb-4 px-2">
              <img src="https://www.gstatic.com/images/branding/googlelogo/svg/googlelogo_clr_74x24dp.svg" alt="Google" className="h-6" />
              <span className="text-[22px] text-[#5f6368] font-normal ml-1">Meet</span>
            </div>
            <button onClick={() => setOpenPanel(null)} className="flex items-center gap-4 px-4 py-3 rounded-full bg-blue-50 text-[#1a73e8] font-medium text-sm">
              <Home className="w-5 h-5" /> Beranda
            </button>
            <button onClick={() => setOpenPanel('settings')} className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-gray-100 text-[#202124] text-sm">
              <Settings className="w-5 h-5" /> Setelan
            </button>
            <button onClick={() => setOpenPanel('feedback')} className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-gray-100 text-[#202124] text-sm">
              <MessageSquare className="w-5 h-5" /> Kirim masukan
            </button>
            <button onClick={() => setOpenPanel('help')} className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-gray-100 text-[#202124] text-sm">
              <HelpCircle className="w-5 h-5" /> Bantuan
            </button>
          </aside>
        </>
      )}

      {/* --- MODAL BANTUAN --- */}
      {openPanel === 'help' && (
        <Modal title="Bantuan" onClose={() => setOpenPanel(null)}>
          <div className="space-y-3 text-sm text-gray-700 leading-6">
            <p><span className="font-medium">Memulai rapat:</span> isi nama Anda, lalu klik <span className="font-medium">Rapat baru</span>. Anda otomatis menjadi host.</p>
            <p><span className="font-medium">Mengundang orang:</span> bagikan kode room (tampil di kiri bawah layar rapat) atau link undangan dari menu "Buat rapat untuk nanti".</p>
            <p><span className="font-medium">Bergabung:</span> masukkan kode room di kolom beranda, atau buka link undangan lalu klik Gabung.</p>
            <p><span className="font-medium">Di dalam rapat:</span> tersedia tombol mikrofon, kamera, berbagi layar, chat (pesan bisa dihapus), dan daftar peserta. Host dapat membisukan atau mengeluarkan peserta.</p>
            <p><span className="font-medium">Izin browser:</span> pilih "Allow/Izinkan" saat browser meminta akses kamera dan mikrofon.</p>
          </div>
        </Modal>
      )}

      {/* --- MODAL MASUKAN --- */}
      {openPanel === 'feedback' && (
        <Modal title="Kirim masukan" onClose={() => setOpenPanel(null)}>
          {feedbackSent ? (
            <div className="flex items-center gap-3 text-green-700 text-sm py-4">
              <Check className="w-5 h-5" /> Terima kasih! Masukan Anda telah terkirim.
            </div>
          ) : (
            <>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Ceritakan pengalaman Anda menggunakan aplikasi ini..."
                rows={4}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm text-[#202124] outline-none focus:border-[#1a73e8] focus:border-2 resize-none"
              />
              <div className="flex justify-end mt-4">
                <button
                  onClick={sendFeedback}
                  disabled={!feedbackText.trim()}
                  className={`px-6 py-2 rounded-full text-sm font-medium ${feedbackText.trim() ? 'bg-[#1a73e8] text-white hover:bg-[#185abc]' : 'bg-gray-200 text-gray-400'}`}
                >
                  Kirim
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* --- MODAL SETELAN --- */}
      {openPanel === 'settings' && (
        <Modal title="Setelan" onClose={() => setOpenPanel(null)}>
          <p className="text-xs text-gray-500 mb-4">Preferensi saat bergabung ke rapat (tersimpan di perangkat ini)</p>
          <label className="flex items-center justify-between py-3 cursor-pointer border-b border-gray-100">
            <span className="flex items-center gap-3 text-sm text-[#202124]"><Mic className="w-5 h-5 text-gray-500" /> Bergabung dengan mikrofon nonaktif</span>
            <input
              type="checkbox"
              checked={joinMuted}
              onChange={(e) => saveJoinPrefs(e.target.checked, joinVideoOff)}
              className="w-5 h-5 accent-[#1a73e8]"
            />
          </label>
          <label className="flex items-center justify-between py-3 cursor-pointer">
            <span className="flex items-center gap-3 text-sm text-[#202124]"><VideoOff className="w-5 h-5 text-gray-500" /> Bergabung dengan kamera nonaktif</span>
            <input
              type="checkbox"
              checked={joinVideoOff}
              onChange={(e) => saveJoinPrefs(joinMuted, e.target.checked)}
              className="w-5 h-5 accent-[#1a73e8]"
            />
          </label>
        </Modal>
      )}

      {/* --- MODAL LINK RAPAT UNTUK NANTI --- */}
      {openPanel === 'laterLink' && (
        <Modal title="Berikut link untuk rapat Anda" onClose={() => setOpenPanel(null)}>
          <p className="text-sm text-gray-600 mb-4 leading-6">
            Salin link ini dan kirimkan kepada orang yang ingin Anda ajak rapat.
            Pastikan Anda menyimpannya agar dapat digunakan nanti.
          </p>
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-4 py-3">
            <span className="text-sm text-[#202124] truncate flex-grow">{`${window.location.origin}/?room=${laterCode}`}</span>
            <button onClick={copyLaterLink} title="Salin link" className="p-2 hover:bg-gray-200 rounded-full shrink-0">
              {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5 text-gray-600" />}
            </button>
          </div>
          <div className="flex justify-end mt-5">
            <button
              onClick={() => goPreJoin(laterCode)}
              className="px-6 py-2 rounded-full text-sm font-medium bg-[#1a73e8] text-white hover:bg-[#185abc]"
            >
              Mulai sekarang
            </button>
          </div>
        </Modal>
      )}

      {/* --- MAIN CONTENT --- */}
      <main className="flex-grow flex flex-col md:flex-row items-center justify-center max-w-7xl mx-auto px-6 lg:px-12 w-full pb-20">

        {/* Sisi Kiri: Teks & Aksi */}
        <div className="flex-1 space-y-8 mt-10 md:mt-0 text-center md:text-left">
          <h1 className="text-[44px] leading-[52px] text-[#202124] font-normal tracking-tight">
            Rapat dan panggilan video untuk semua orang
          </h1>
          <p className="text-[18px] text-[#5f6368] leading-7 max-w-lg mx-auto md:mx-0">
            Terhubung, berkolaborasi, dan merayakan dari mana saja dengan Google Meet
          </p>

          {/* Input Nama Peserta */}
          <div className="flex justify-center md:justify-start">
            <div className="flex items-center border border-gray-400 rounded-[4px] px-3 py-[10px] focus-within:border-[#1a73e8] focus-within:border-2 transition-all duration-75 w-full max-w-xs">
              <input
                ref={nameInputRef}
                type="text"
                placeholder="Masukkan nama Anda"
                className="outline-none bg-transparent w-full text-[#202124] placeholder:text-[#5f6368]"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6 justify-center md:justify-start">
            {/* Tombol Rapat baru + dropdown pilihan */}
            <div className="relative">
              <button
                onClick={() => setOpenPanel(openPanel === 'newMeeting' ? null : 'newMeeting')}
                className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#185abc] text-white px-6 py-3 rounded-[4px] font-medium transition shadow-md whitespace-nowrap"
              >
                <Video className="w-5 h-5 fill-current" />
                Rapat baru
              </button>

              {openPanel === 'newMeeting' && (
                <div className="absolute left-0 top-14 bg-white border border-gray-200 rounded-lg shadow-xl py-2 w-72 z-30 text-left">
                  <button onClick={handleCreateForLater} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 w-full text-sm text-[#202124]">
                    <CalendarPlus className="w-5 h-5 text-[#5f6368]" /> Buat rapat untuk nanti
                  </button>
                  <button onClick={handleCreateRoom} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 w-full text-sm text-[#202124]">
                    <Plus className="w-5 h-5 text-[#5f6368]" /> Mulai rapat instan
                  </button>
                </div>
              )}
            </div>

            {/* Input dengan Icon Keyboard */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center border border-gray-400 rounded-[4px] px-3 py-[10px] focus-within:border-[#1a73e8] focus-within:border-2 transition-all duration-75">
                <Keyboard className="w-5 h-5 text-[#5f6368] mr-3" />
                <input
                  type="text"
                  placeholder="Masukkan kode atau link"
                  className="outline-none bg-transparent w-44 md:w-56 text-[#202124] placeholder:text-[#5f6368]"
                  value={roomCode}
                  onChange={(e) => setRoomCode(extractRoomCode(e.target.value))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleJoinRoom(); }} // Bisa tekan Enter untuk gabung
                />
              </div>
              <button
                onClick={handleJoinRoom}
                className={`font-semibold px-4 py-2 transition ${roomCode.trim() ? 'text-[#1a73e8] hover:bg-blue-50 cursor-pointer' : 'text-gray-400 cursor-default'}`}
                disabled={!roomCode.trim()}
              >
                Gabung
              </button>
            </div>
          </div>

          <div className="pt-8 border-t border-gray-200">
            <p className="text-sm text-[#5f6368]">
              <button onClick={() => setOpenPanel('help')} className="text-[#1a73e8] cursor-pointer hover:underline">Pelajari lebih lanjut</button> tentang Google Meet
            </p>
          </div>
        </div>

        {/* Sisi Kanan: Ilustrasi Tengah */}
        <div className="flex-1 flex flex-col items-center justify-center mt-16 md:mt-0">
          <div className="relative group cursor-pointer" onClick={handleCreateForLater} title="Buat rapat & dapatkan link">
            <div className="w-[320px] h-[320px] md:w-[420px] md:h-[420px] bg-gray-50 rounded-full flex items-center justify-center shadow-inner overflow-hidden border border-gray-100">
               <div className="absolute w-[90%] h-[90%] border-2 border-dashed border-gray-200 rounded-full animate-[spin_20s_linear_infinite]"></div>
               <div className="text-[180px] font-bold text-[#34a853] opacity-30 select-none">1</div>
            </div>
          </div>
          <div className="mt-8 text-center max-w-sm">
            <h3 className="text-[24px] text-[#202124] leading-8 font-normal mb-2">
              Dapatkan link yang dapat Anda bagikan
            </h3>
            <p className="text-[14px] text-[#5f6368] px-4">
              Klik <span className="font-bold">Rapat baru</span> untuk mendapatkan link yang dapat Anda kirimkan ke orang yang ingin Anda ajak rapat.
            </p>
          </div>
        </div>

      </main>
    </div>
  );
}

export default App;
