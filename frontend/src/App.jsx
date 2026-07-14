import { useState } from 'react';
import { Video, Keyboard, Settings, HelpCircle, MessageSquare, Menu, Grid } from 'lucide-react';
import RoomView from './components/RoomView'; // Mengambil komponen RoomView

function App() {
  const [view, setView] = useState("landing"); // Menentukan halaman: 'landing' atau 'room'
  const [roomCode, setRoomCode] = useState("");

  // Fungsi untuk membuat kode acak otomatis saat klik "Rapat baru"
  const handleCreateRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 5) + '-' + 
                       Math.random().toString(36).substring(2, 7) + '-' + 
                       Math.random().toString(36).substring(2, 5);
    setRoomCode(randomCode);
    setView("room");
  };

  // Fungsi untuk bergabung ketika memasukkan kode room secara manual
  const handleJoinRoom = () => {
    if (roomCode.trim()) {
      // Menghapus spasi di awal/akhir jika tidak sengaja terketik
      setRoomCode(roomCode.trim()); 
      setView("room");
    }
  };

  // Fungsi untuk kembali ke halaman utama ketika menutup panggilan
  const handleLeaveRoom = () => {
    setView("landing");
    setRoomCode(""); // Reset kode room kembali kosong saat keluar
  };

  // CONDITIONAL RENDERING: Jika sedang dalam room, tampilkan halaman meeting video
  if (view === "room") {
    return <RoomView roomCode={roomCode} onLeave={handleLeaveRoom} />;
  }

  // TAMPILAN UTAMA (LANDING PAGE)
  return (
    <div className="min-h-screen bg-white text-[#5f6368] flex flex-col font-sans">
      {/* --- NAVBAR --- */}
      <header className="flex items-center justify-between px-4 h-16 w-full">
        <div className="flex items-center">
          <button className="p-3 hover:bg-gray-100 rounded-full transition">
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
            11.05 • Jum, 22 Mei
          </div>
          <button className="p-2.5 hover:bg-gray-100 rounded-full"><HelpCircle className="w-6 h-6" /></button>
          <button className="p-2.5 hover:bg-gray-100 rounded-full"><MessageSquare className="w-6 h-6" /></button>
          <button className="p-2.5 hover:bg-gray-100 rounded-full"><Settings className="w-6 h-6" /></button>
          
          <div className="flex items-center ml-4 space-x-2">
            <button className="p-2.5 hover:bg-gray-100 rounded-full"><Grid className="w-6 h-6" /></button>
            <div className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center text-white text-sm font-medium cursor-pointer shadow-sm">
              P
            </div>
          </div>
        </div>
      </header>

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

          <div className="flex flex-col sm:flex-row items-center gap-6 justify-center md:justify-start">
            {/* Tombol Rapat baru */}
            <button 
              onClick={handleCreateRoom}
              className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#185abc] text-white px-6 py-3 rounded-[4px] font-medium transition shadow-md whitespace-nowrap"
            >
              <Video className="w-5 h-5 fill-current" />
              Rapat baru
            </button>

            {/* Input dengan Icon Keyboard */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center border border-gray-400 rounded-[4px] px-3 py-[10px] focus-within:border-[#1a73e8] focus-within:border-2 transition-all duration-75">
                <Keyboard className="w-5 h-5 text-[#5f6368] mr-3" />
                <input 
                  type="text" 
                  placeholder="Masukkan Kode Room Meeting"
                  className="outline-none bg-transparent w-44 md:w-56 text-[#202124] placeholder:text-[#5f6368]"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
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
              <span className="text-[#1a73e8] cursor-pointer hover:underline">Pelajari lebih lanjut</span> tentang Google Meet
            </p>
          </div>
        </div>

        {/* Sisi Kanan: Ilustrasi Tengah */}
        <div className="flex-1 flex flex-col items-center justify-center mt-16 md:mt-0">
          <div className="relative group cursor-pointer">
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