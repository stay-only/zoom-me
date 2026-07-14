import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Shield, MessageSquare, Users, Info } from 'lucide-react';
import { io } from 'socket.io-client';

// Ganti IP dengan IP komputer server NestJS Anda di jaringan lokal (LAN)
const SOCKET_SERVER_URL = "http://localhost:5000"; 

// Konfigurasi standar STUN server gratis untuk membantu menembus firewall lokal
const iceServersConfig = {
  iceServers: []
};

/**
 * Komponen Pembantu untuk merender video peserta lain secara stabil.
 * Memisahkan ini menjadi komponen tersendiri mencegah video "freeze" 
 * akibat siklus render ulang komponen utama.
 */
function RemoteVideo({ stream, userId }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="aspect-video bg-[#3c4043] rounded-xl relative overflow-hidden shadow-2xl border border-gray-700 flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md text-sm font-medium">
        Partisipan ({userId.substring(0, 4)})
      </div>
    </div>
  );
}

function RoomView({ roomCode, onLeave }) {
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef({}); // Menyimpan objek RTCPeerConnection untuk setiap user ID
  
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // { socketId: MediaStream }
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  useEffect(() => {
    let stream;

    async function initMeeting() {
      // 1. Ambil Media Lokal (Kamera & Mic)
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error("Akses hardware gagal:", error);
        alert("Mohon izinkan akses kamera dan mikrofon. Ingat, di jaringan lokal/LAN wajib menggunakan localhost atau HTTPS agar browser mengizinkan akses media.");
        return;
      }

      // 2. Hubungkan ke NestJS Signaling Server
      socketRef.current = io(SOCKET_SERVER_URL);

      // Kirim sinyal bahwa kita bergabung ke room tertentu
      socketRef.current.emit('join-room', { roomCode });

      // [Sinyal A]: Ada user lain yang baru masuk, kita inisiasi penawaran (Offer)
      socketRef.current.on('user-joined', async ({ userId }) => {
        console.log(`User baru bergabung: ${userId}, menginisiasi WebRTC Offer...`);
        const peerConnection = createPeerConnection(userId, stream);
        peersRef.current[userId] = peerConnection;

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socketRef.current.emit('send-offer', { targetId: userId, offer });
      });

      // [Sinyal B]: Menerima Offer dari user lain, kita buat balasan (Answer)
      socketRef.current.on('receive-offer', async ({ senderId, offer }) => {
        console.log(`Menerima Offer dari ${senderId}, membuat WebRTC Answer...`);
        const peerConnection = createPeerConnection(senderId, stream);
        peersRef.current[senderId] = peerConnection;

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socketRef.current.emit('send-answer', { targetId: senderId, answer });
      });

      // [Sinyal C]: Menerima Answer dari target user
      socketRef.current.on('receive-answer', async ({ senderId, answer }) => {
        console.log(`Menerima Answer dari ${senderId}, mematangkan jabat tangan WebRTC...`);
        const peerConnection = peersRef.current[senderId];
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      // [Sinyal D]: Menerima kandidat jalur koneksi internet/lokal (ICE Candidate)
      socketRef.current.on('receive-ice-candidate', async ({ senderId, candidate }) => {
        const peerConnection = peersRef.current[senderId];
        if (peerConnection && candidate) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("Gagal menambahkan ICE Candidate:", e);
          }
        }
      });

      // [Sinyal E]: Ada user yang keluar atau terputus
      socketRef.current.on('user-disconnected', ({ userId }) => {
        console.log(`User terputus: ${userId}, membersihkan resource...`);
        if (peersRef.current[userId]) {
          peersRef.current[userId].close();
          delete peersRef.current[userId];
        }
        setRemoteStreams(prev => {
          const updated = { ...prev };
          delete updated[userId];
          return updated;
        });
      });
    }

    initMeeting();

    // Cleanup saat meninggalkan ruangan
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (socketRef.current) socketRef.current.disconnect();
      Object.values(peersRef.current).forEach(peer => peer.close());
    };
  }, [roomCode]);

  // Fungsi Inti WebRTC: Membuat koneksi Peer-to-Peer
  const createPeerConnection = (targetUserId, currentStream) => {
    const pc = new RTCPeerConnection(iceServersConfig);

    // Masukkan track video & audio lokal ke jalur koneksi peer
    if (currentStream) {
      currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
    }

    // Kirim kandidat ICE kita ke user target lewat server NestJS
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('send-ice-candidate', {
          targetId: targetUserId,
          candidate: event.candidate
        });
      }
    };

    // Tangkap stream video dari user jarak jauh (remote) jika sudah terhubung
    pc.ontrack = (event) => {
      console.log(`Berhasil menangkap jalur track video remote dari user: ${targetUserId}`);
      setRemoteStreams(prev => ({
        ...prev,
        [targetUserId]: event.streams[0]
      }));
    };

    return pc;
  };

  // Toggling fungsi media lokal
  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Hitung jumlah total partisipan (Klien lokal + remote)
  const totalParticipants = 1 + Object.keys(remoteStreams).length;

  return (
    <div className="min-h-screen bg-[#202124] text-white flex flex-col justify-between font-sans select-none">
      
      {/* --- AREA VIDEO GRID (DINAMIS BERDASARKAN PESERTA) --- */}
      <div className="flex-grow flex items-center justify-center p-6">
        <div className={`w-full max-w-6xl grid gap-4 items-center justify-center transition-all duration-300 ${
          totalParticipants <= 1 ? 'grid-cols-1 max-w-3xl' : 
          totalParticipants === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        }`}>
          
          {/* Box Video Lokal (Anda) */}
          <div className="aspect-video bg-[#3c4043] rounded-xl relative overflow-hidden shadow-2xl border border-gray-700 flex items-center justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${isVideoOff ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#202124]">
                <div className="w-24 h-24 bg-blue-700 rounded-full flex items-center justify-center text-3xl font-medium">I</div>
                <span className="mt-4 text-sm text-gray-400">Kamera dinonaktifkan</span>
              </div>
            )}
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2">
              {isMuted && <MicOff className="w-4 h-4 text-red-500" />}
              Anda (Imam Saputra)
            </div>
          </div>

          {/* Rendering Video Partisipan Lain secara Dinamis menggunakan Komponen Stabil */}
          {Object.entries(remoteStreams).map(([userId, remoteStream]) => (
            <RemoteVideo 
              key={userId} 
              stream={remoteStream} 
              userId={userId} 
            />
          ))}

        </div>
      </div>

      {/* --- ACTION CONTROLS BAR (BAWAH) --- */}
      <div className="h-20 bg-[#202124] px-6 flex items-center justify-between border-t border-gray-800/50">
        <div className="flex items-center space-x-3 text-sm font-medium text-gray-300 w-1/4 hidden md:flex">
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-gray-600">|</span>
          <span className="tracking-wider">{roomCode}</span>
        </div>

        <div className="flex items-center justify-center gap-3 flex-1 md:flex-initial">
          <button onClick={toggleMute} className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
            {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
          </button>

          <button onClick={toggleVideo} className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
            {isVideoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>

          <button onClick={onLeave} className="p-3.5 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all duration-200 shadow-md px-6 flex items-center justify-center">
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-end space-x-1 w-1/4 hidden md:flex text-gray-400">
          <button className="p-2.5 hover:bg-gray-800 rounded-full transition"><Info className="w-5 h-5" /></button>
          <button className="p-2.5 hover:bg-gray-800 rounded-full transition relative">
            <Users className="w-5 h-5" />
            <span className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] px-1 rounded-full">{totalParticipants}</span>
          </button>
          <button className="p-2.5 hover:bg-gray-800 rounded-full transition"><MessageSquare className="w-5 h-5" /></button>
          <button className="p-2.5 hover:bg-gray-800 rounded-full transition"><Shield className="w-5 h-5" /></button>
        </div>
      </div>

    </div>
  );
}

export default RoomView;