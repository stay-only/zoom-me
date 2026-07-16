import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, ArrowLeft } from 'lucide-react';

/**
 * Halaman pra-gabung ala Google Meet: pratinjau kamera, atur mic/kamera,
 * pilih perangkat, dan konfirmasi nama SEBELUM masuk rapat.
 */
function PreJoin({ roomCode, userName, setUserName, initialMicOn = true, initialCamOn = true, onJoin, onBack }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [micOn, setMicOn] = useState(initialMicOn);
  const [camOn, setCamOn] = useState(initialCamOn);
  const [mediaError, setMediaError] = useState(null);
  const [devices, setDevices] = useState({ mics: [], cams: [] });
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem('meet:micId') || '');
  const [selectedCam, setSelectedCam] = useState(() => localStorage.getItem('meet:camId') || '');

  // Ambil pratinjau dengan perangkat tertentu; dipakai saat buka halaman
  // dan setiap kali pengguna memilih kamera/mic lain dari dropdown.
  const acquirePreview = async (micId, camId) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: camId ? { deviceId: { ideal: camId } } : true,
      audio: micId ? { deviceId: { ideal: micId } } : true,
    });
    const at = stream.getAudioTracks()[0];
    const vt = stream.getVideoTracks()[0];
    if (at) at.enabled = micOn;
    if (vt) vt.enabled = camOn;
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
    return stream;
  };

  useEffect(() => {
    let cancelled = false;

    async function initPreview() {
      try {
        const stream = await acquirePreview(selectedMic, selectedCam);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }
        // Daftar perangkat (label hanya muncul setelah izin diberikan)
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices({
            mics: list.filter((d) => d.kind === 'audioinput'),
            cams: list.filter((d) => d.kind === 'videoinput'),
          });
        }
      } catch (err) {
        console.error('Pratinjau media gagal:', err);
        if (!cancelled) setMediaError(err.name || 'Error');
      }
    }
    initPreview();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // Pratinjau hanya diambil sekali saat halaman dibuka; preferensi awal
    // cukup diterapkan pada saat itu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ganti perangkat dari dropdown: simpan pilihan + ambil ulang pratinjau
  const changeDevice = async (kind, deviceId) => {
    if (kind === 'audio') {
      setSelectedMic(deviceId);
      localStorage.setItem('meet:micId', deviceId);
      await acquirePreview(deviceId, selectedCam).catch(() => {});
    } else {
      setSelectedCam(deviceId);
      localStorage.setItem('meet:camId', deviceId);
      await acquirePreview(selectedMic, deviceId).catch(() => {});
    }
  };

  const toggleMic = () => {
    const next = !micOn;
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = next;
    setMicOn(next);
  };

  const toggleCam = () => {
    const next = !camOn;
    const track = streamRef.current?.getVideoTracks()[0];
    if (track) track.enabled = next;
    setCamOn(next);
  };

  const handleJoin = () => {
    // Matikan stream pratinjau; RoomView akan meminta media sendiri
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onJoin({ micOn, camOn });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans">
      <header className="flex items-center px-4 h-16">
        <button onClick={onBack} className="p-3 hover:bg-gray-100 rounded-full transition" title="Kembali">
          <ArrowLeft className="w-5 h-5 text-[#5f6368]" />
        </button>
        <span className="ml-2 text-[#5f6368]">
          Kode rapat: <span className="font-medium text-[#202124] tracking-wider">{roomCode}</span>
        </span>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row items-center justify-center gap-10 px-6 pb-16 max-w-6xl mx-auto w-full">
        {/* Pratinjau video */}
        <div className="w-full max-w-2xl">
          <div className="aspect-video bg-[#202124] rounded-xl relative overflow-hidden shadow-lg flex items-center justify-center">
            {camOn && !mediaError ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
            ) : (
              <div className="flex flex-col items-center text-white">
                <div className="w-24 h-24 bg-blue-700 rounded-full flex items-center justify-center text-4xl font-medium">
                  {(userName.trim() || 'T').charAt(0).toUpperCase()}
                </div>
                <span className="mt-3 text-sm text-gray-300">
                  {mediaError ? 'Kamera tidak tersedia / belum diizinkan' : 'Kamera mati'}
                </span>
              </div>
            )}

            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
              <button
                onClick={toggleMic}
                className={`p-3.5 rounded-full border transition ${micOn ? 'bg-transparent border-white/60 hover:bg-white/10' : 'bg-red-500 border-red-500 hover:bg-red-600'}`}
                title={micOn ? 'Matikan mikrofon' : 'Nyalakan mikrofon'}
              >
                {micOn ? <Mic className="w-5 h-5 text-white" /> : <MicOff className="w-5 h-5 text-white" />}
              </button>
              <button
                onClick={toggleCam}
                className={`p-3.5 rounded-full border transition ${camOn ? 'bg-transparent border-white/60 hover:bg-white/10' : 'bg-red-500 border-red-500 hover:bg-red-600'}`}
                title={camOn ? 'Matikan kamera' : 'Nyalakan kamera'}
              >
                {camOn ? <Video className="w-5 h-5 text-white" /> : <VideoOff className="w-5 h-5 text-white" />}
              </button>
            </div>
          </div>
          {mediaError && (
            <p className="mt-3 text-sm text-amber-600">
              Anda tetap bisa bergabung tanpa kamera/mikrofon — izinkan akses dari ikon 🔒 di address bar untuk mengaktifkannya.
            </p>
          )}

          {/* Pemilih perangkat */}
          {(devices.mics.length > 0 || devices.cams.length > 0) && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#5f6368] mb-1">Mikrofon</label>
                <select
                  value={selectedMic}
                  onChange={(e) => changeDevice('audio', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-[#202124] outline-none focus:border-[#1a73e8] bg-white"
                >
                  {devices.mics.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Mikrofon ${i + 1}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#5f6368] mb-1">Kamera</label>
                <select
                  value={selectedCam}
                  onChange={(e) => changeDevice('video', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-[#202124] outline-none focus:border-[#1a73e8] bg-white"
                >
                  {devices.cams.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Kamera ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Kolom kanan: nama & tombol gabung */}
        <div className="flex flex-col items-center text-center w-full max-w-sm">
          <h1 className="text-[28px] text-[#202124] font-normal">Siap untuk bergabung?</h1>
          <input
            type="text"
            placeholder="Masukkan nama Anda"
            className="mt-6 w-full border border-gray-400 rounded-[4px] px-4 py-3 outline-none focus:border-[#1a73e8] focus:border-2 text-[#202124]"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && userName.trim()) handleJoin(); }}
            autoFocus
          />
          <button
            onClick={handleJoin}
            disabled={!userName.trim()}
            className={`mt-5 px-10 py-3 rounded-full font-medium transition shadow-md ${userName.trim() ? 'bg-[#1a73e8] hover:bg-[#185abc] text-white cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-default'}`}
          >
            Gabung sekarang
          </button>
          <p className="mt-4 text-sm text-[#5f6368]">Belum ada orang lain di sini? Bagikan link rapat setelah bergabung.</p>
        </div>
      </main>
    </div>
  );
}

export default PreJoin;
