import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Users, Info,
  MonitorUp, X, Send, Trash2, UserX, Crown, Hand, SmilePlus, Copy, Check,
  Pin, PinOff, Maximize, Minimize, WifiOff,
} from 'lucide-react';
import { io } from 'socket.io-client';

// Socket.IO terhubung ke ORIGIN HALAMAN yang sama — backend menyajikan
// frontend & WebSocket dari satu port, jadi tidak ada lagi tebak-tebakan
// port kedua yang bisa gagal di-forward/public. Saat dev via Vite,
// /socket.io diproxy ke backend (lihat vite.config.js).

// STUN membantu perangkat menemukan alamat publiknya; TURN merelay media bila
// koneksi langsung diblokir NAT (wajib untuk perangkat beda jaringan, mis. HP via 4G).
const iceServersConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🎉'];

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Video peserta lain — komponen terpisah agar tidak "freeze" saat re-render. */
function RemoteVideo({ stream, name, micOn, handRaised, pinned, onTogglePin, large }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={`bg-[#3c4043] rounded-xl relative overflow-hidden shadow-2xl border border-gray-700 flex items-center justify-center group ${large ? 'w-full h-full' : 'aspect-video'}`}>
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2">
        {micOn === false && <MicOff className="w-4 h-4 text-red-400" />}
        {handRaised && <Hand className="w-4 h-4 text-yellow-400" />}
        {name}
      </div>
      <button
        onClick={onTogglePin}
        title={pinned ? 'Lepas pin' : 'Pin video ini'}
        className="absolute top-3 right-3 p-2 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition hover:bg-black/70"
      >
        {pinned ? <PinOff className="w-4 h-4 text-white" /> : <Pin className="w-4 h-4 text-white" />}
      </button>
    </div>
  );
}

function RoomView({ roomCode, userName, joinMuted = false, joinVideoOff = false, onLeave }) {
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef({}); // RTCPeerConnection per user id
  const localStreamRef = useRef(null);
  const cameraTrackRef = useRef(null); // track kamera asli saat berbagi layar
  const screenStreamRef = useRef(null);
  const chatEndRef = useRef(null);
  const activePanelRef = useRef(null);

  const [remoteStreams, setRemoteStreams] = useState({}); // { socketId: MediaStream }
  const [isMuted, setIsMuted] = useState(joinMuted);
  const [isVideoOff, setIsVideoOff] = useState(joinVideoOff);
  const [isSharing, setIsSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [socketConnected, setSocketConnected] = useState(true);

  const [myId, setMyId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState([]); // [{ id, name, isHost, micOn, camOn, handRaised, isSharing }]

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [activePanel, setActivePanel] = useState(null); // null | 'chat' | 'people' | 'info'

  const [reactions, setReactions] = useState([]); // reaksi emoji melayang
  const [toasts, setToasts] = useState([]); // notifikasi kecil (join/leave/dll)
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pinnedId, setPinnedId] = useState(null); // 'me' | socketId | null
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Simpan panel aktif di ref agar handler socket (closure lama) tetap akurat
  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  const inviteLink = `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;

  const makeMessageId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

  const addToast = useCallback((text) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // ---------- INISIALISASI: MEDIA + SOCKET + WEBRTC ----------
  useEffect(() => {
    // Flag 'cancelled' mencegah React StrictMode (efek berjalan 2x saat dev)
    // membuat DUA koneksi socket — inilah penyebab "user ganda" sebelumnya.
    let cancelled = false;
    let stream = null;
    let socket = null;

    const createPeerConnection = (targetUserId) => {
      const pc = new RTCPeerConnection(iceServersConfig);

      const current = localStreamRef.current;
      if (current) {
        current.getTracks().forEach((track) => pc.addTrack(track, current));
        // Jika sedang berbagi layar, peer baru langsung menerima track layar
        const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
        if (screenTrack) {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('send-ice-candidate', {
            targetId: targetUserId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        setRemoteStreams((prev) => ({ ...prev, [targetUserId]: event.streams[0] }));
      };

      // Jalur media putus? Minta negosiasi ICE ulang otomatis.
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') pc.restartIce();
      };

      return pc;
    };

    async function initMeeting() {
      // 1. Ambil media lokal. Gagal (kamera/mic ditolak) TIDAK menghalangi join —
      //    tetap bisa masuk untuk chat & melihat peserta lain (seperti Meet).
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const audioTrack = stream.getAudioTracks()[0];
        const videoTrack = stream.getVideoTracks()[0];
        if (audioTrack) audioTrack.enabled = !joinMuted;
        if (videoTrack) videoTrack.enabled = !joinVideoOff;

        localStreamRef.current = stream;
        cameraTrackRef.current = videoTrack || null;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (error) {
        console.error('Akses kamera/mikrofon gagal:', error);
        if (cancelled) return;
        addToast('Bergabung tanpa kamera/mikrofon (akses ditolak atau tidak tersedia)');
        setIsMuted(true);
        setIsVideoOff(true);
      }

      if (cancelled) return;

      // 2. Hubungkan ke server signaling — SATU origin dengan halaman ini.
      socket = io({ transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => setSocketConnected(true));
      socket.on('disconnect', () => setSocketConnected(false));

      const hasMic = !!stream?.getAudioTracks().length;
      const hasCam = !!stream?.getVideoTracks().length;

      socket.emit('join-room', { roomCode, userName });
      socket.emit('media-state', { micOn: hasMic && !joinMuted, camOn: hasCam && !joinVideoOff });

      // Setelah reconnect otomatis (server restart / sinyal hilang), gabung ulang
      socket.io.on('reconnect', () => {
        socket.emit('join-room', { roomCode, userName });
      });

      socket.on('joined', ({ userId, isHost }) => {
        setMyId(userId);
        setIsHost(isHost);
      });

      socket.on('participants-updated', ({ participants }) => {
        setParticipants(participants);
      });

      socket.on('host-changed', ({ hostId, hostName }) => {
        setMyId((currentId) => {
          setIsHost(hostId === currentId);
          if (hostId === currentId) addToast('Anda sekarang menjadi host rapat ini');
          else if (hostName) addToast(`${hostName} sekarang menjadi host`);
          return currentId;
        });
      });

      // Peserta baru masuk → peserta lama menginisiasi offer WebRTC
      socket.on('user-joined', async ({ userId, userName: newName }) => {
        addToast(`${newName || 'Seseorang'} bergabung ke rapat`);
        const pc = createPeerConnection(userId);
        peersRef.current[userId] = pc;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('send-offer', { targetId: userId, offer });
      });

      socket.on('receive-offer', async ({ senderId, offer }) => {
        const pc = createPeerConnection(senderId);
        peersRef.current[senderId] = pc;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('send-answer', { targetId: senderId, answer });
      });

      socket.on('receive-answer', async ({ senderId, answer }) => {
        const pc = peersRef.current[senderId];
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
      });

      socket.on('receive-ice-candidate', async ({ senderId, candidate }) => {
        const pc = peersRef.current[senderId];
        if (pc && candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('Gagal menambahkan ICE Candidate:', e);
          }
        }
      });

      socket.on('user-disconnected', ({ userId, userName: goneName }) => {
        if (goneName) addToast(`${goneName} meninggalkan rapat`);
        if (peersRef.current[userId]) {
          peersRef.current[userId].close();
          delete peersRef.current[userId];
        }
        setRemoteStreams((prev) => {
          const updated = { ...prev };
          delete updated[userId];
          return updated;
        });
        setPinnedId((prev) => (prev === userId ? null : prev));
      });

      // ---- CHAT ----
      socket.on('chat-message', (msg) => {
        setChatMessages((prev) => [...prev, msg]);
        if (activePanelRef.current !== 'chat') setUnreadCount((c) => c + 1);
      });

      socket.on('message-deleted', ({ messageId }) => {
        setChatMessages((prev) => prev.filter((m) => m.messageId !== messageId));
      });

      // ---- REAKSI & ANGKAT TANGAN ----
      socket.on('reaction', ({ userId, userName: fromName, emoji }) => {
        const id = `${Date.now()}-${userId}-${Math.random()}`;
        setReactions((prev) => [...prev.slice(-14), { id, emoji, name: fromName }]);
        setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 3500);
      });

      socket.on('hand-raised', ({ userId, userName: fromName, raised }) => {
        setMyId((currentId) => {
          if (raised && userId !== currentId) addToast(`✋ ${fromName} mengangkat tangan`);
          return currentId;
        });
      });

      // ---- LAYAR ----
      socket.on('screen-share', ({ userName: fromName, sharing }) => {
        if (sharing) addToast(`${fromName} mulai berbagi layar`);
      });

      // ---- MODERASI ----
      socket.on('force-mute', () => {
        const audioTrack = localStreamRef.current?.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = false;
        setIsMuted(true);
        socket.emit('media-state', { micOn: false });
        addToast('Anda dibisukan oleh host');
      });

      socket.on('kicked', () => {
        alert('Anda telah dikeluarkan dari rapat oleh host.');
        onLeave();
      });

      socket.on('meeting-ended', () => {
        alert('Rapat telah diakhiri oleh host.');
        onLeave();
      });
    }

    initMeeting();

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (socket) socket.disconnect();
      socketRef.current = null;
      Object.values(peersRef.current).forEach((pc) => pc.close());
      peersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, userName]);

  // Timer durasi rapat
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll chat ke pesan terbaru
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, activePanel]);

  // Sinkronkan state fullscreen dengan tombol Esc bawaan browser
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ---------- KONTROL MEDIA ----------
  const replaceVideoTrackForAllPeers = (newTrack) => {
    Object.values(peersRef.current).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
    });
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
    socketRef.current?.emit('media-state', { micOn: audioTrack.enabled });
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoOff(!videoTrack.enabled);
    socketRef.current?.emit('media-state', { camOn: videoTrack.enabled });
  };

  // ---------- BERBAGI LAYAR ----------
  const startScreenShare = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      replaceVideoTrackForAllPeers(screenTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
      setIsSharing(true);
      socketRef.current?.emit('screen-share', { sharing: true });

      // Tombol "Stop sharing" bawaan browser
      screenTrack.onended = () => stopScreenShare();
    } catch (error) {
      console.error('Berbagi layar dibatalkan/gagal:', error);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    const camTrack = cameraTrackRef.current;
    if (camTrack) replaceVideoTrackForAllPeers(camTrack);
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    setIsSharing(false);
    socketRef.current?.emit('screen-share', { sharing: false });
  };

  const toggleScreenShare = () => (isSharing ? stopScreenShare() : startScreenShare());

  // ---------- CHAT ----------
  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.emit('chat-message', { messageId: makeMessageId(), text });
    setChatInput('');
  };

  const deleteChat = (msg) => {
    socketRef.current?.emit('delete-message', {
      messageId: msg.messageId,
      ownerId: msg.senderId,
    });
  };

  // ---------- REAKSI & TANGAN ----------
  const sendReaction = (emoji) => {
    socketRef.current?.emit('reaction', { emoji });
    setShowReactionPicker(false);
  };

  const toggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    socketRef.current?.emit('raise-hand', { raised: next });
  };

  // ---------- MODERASI (HOST) ----------
  const muteParticipant = (targetId) =>
    socketRef.current?.emit('mute-participant', { targetId });

  const muteAll = () => {
    socketRef.current?.emit('mute-all');
    addToast('Semua peserta lain dibisukan');
  };

  const kickParticipant = (targetId) => {
    if (window.confirm('Keluarkan peserta ini dari rapat?')) {
      socketRef.current?.emit('kick-participant', { targetId });
    }
  };

  const endMeetingForAll = () => {
    if (window.confirm('Akhiri rapat untuk SEMUA peserta?')) {
      socketRef.current?.emit('end-meeting');
      onLeave();
    }
  };

  // ---------- LAIN-LAIN ----------
  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      // Fallback untuk browser tanpa izin Clipboard API
      const ta = document.createElement('textarea');
      ta.value = inviteLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  const togglePanel = (panel) => {
    setActivePanel((prev) => {
      const next = prev === panel ? null : panel;
      if (next === 'chat') setUnreadCount(0);
      return next;
    });
  };

  const namesById = {};
  participants.forEach((p) => { namesById[p.id] = p; });

  // Callback ref: video lokal bisa remount saat pin/unpin, jadi srcObject
  // harus dipasang ulang setiap elemen <video> baru dibuat.
  const attachLocalVideo = (el) => {
    localVideoRef.current = el;
    if (el) {
      const s = screenStreamRef.current || localStreamRef.current;
      if (s && el.srcObject !== s) el.srcObject = s;
    }
  };

  const totalParticipants = participants.length || 1 + Object.keys(remoteStreams).length;
  const remoteEntries = Object.entries(remoteStreams);

  // Spotlight: video yang di-pin tampil besar, sisanya menjadi strip thumbnail
  const spotlight = pinnedId && (pinnedId === 'me' || remoteStreams[pinnedId]) ? pinnedId : null;

  const renderLocalTile = (large = false) => (
    <div className={`bg-[#3c4043] rounded-xl relative overflow-hidden shadow-2xl border border-gray-700 flex items-center justify-center group ${large ? 'w-full h-full' : 'aspect-video'}`}>
      <video
        ref={attachLocalVideo}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transition-opacity duration-300 ${isSharing ? '' : 'transform -scale-x-100'} ${isVideoOff && !isSharing ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      />
      {isVideoOff && !isSharing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#202124]">
          <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center text-3xl font-medium">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="mt-3 text-sm text-gray-400">Kamera dinonaktifkan</span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2">
        {isMuted && <MicOff className="w-4 h-4 text-red-400" />}
        {handRaised && <Hand className="w-4 h-4 text-yellow-400" />}
        Anda ({userName}){isSharing && ' • Berbagi layar'}
      </div>
      <button
        onClick={() => setPinnedId((p) => (p === 'me' ? null : 'me'))}
        title={spotlight === 'me' ? 'Lepas pin' : 'Pin video Anda'}
        className="absolute top-3 right-3 p-2 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition hover:bg-black/70"
      >
        {spotlight === 'me' ? <PinOff className="w-4 h-4 text-white" /> : <Pin className="w-4 h-4 text-white" />}
      </button>
    </div>
  );

  return (
    <div className="h-screen bg-[#202124] text-white flex flex-col font-sans select-none overflow-hidden">

      {/* Banner koneksi terputus */}
      {!socketConnected && (
        <div className="bg-amber-600 text-white text-sm text-center py-1.5 flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" /> Koneksi ke server terputus — mencoba menyambung ulang...
        </div>
      )}

      <div className="flex-grow flex overflow-hidden relative">
        {/* Overlay reaksi melayang */}
        <div className="pointer-events-none absolute bottom-24 left-6 z-30 flex flex-col-reverse gap-1">
          {reactions.map((r) => (
            <div key={r.id} className="flex items-center gap-2 animate-bounce">
              <span className="text-4xl drop-shadow">{r.emoji}</span>
              <span className="text-xs bg-black/60 px-2 py-0.5 rounded-full">{r.name}</span>
            </div>
          ))}
        </div>

        {/* Overlay toast notifikasi */}
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
          {toasts.map((t) => (
            <div key={t.id} className="bg-black/75 backdrop-blur text-sm px-4 py-2 rounded-full shadow-lg">
              {t.text}
            </div>
          ))}
        </div>

        {/* --- AREA VIDEO --- */}
        <div className="flex-grow flex flex-col p-4 gap-3 min-w-0">
          {spotlight ? (
            <>
              <div className="flex-grow min-h-0">
                {spotlight === 'me'
                  ? renderLocalTile(true)
                  : (
                    <RemoteVideo
                      large
                      stream={remoteStreams[spotlight]}
                      name={namesById[spotlight]?.name || 'Partisipan'}
                      micOn={namesById[spotlight]?.micOn}
                      handRaised={namesById[spotlight]?.handRaised}
                      pinned
                      onTogglePin={() => setPinnedId(null)}
                    />
                  )}
              </div>
              <div className="h-28 flex gap-3 overflow-x-auto shrink-0">
                {spotlight !== 'me' && <div className="w-44 shrink-0">{renderLocalTile()}</div>}
                {remoteEntries
                  .filter(([id]) => id !== spotlight)
                  .map(([userId, remoteStream]) => (
                    <div key={userId} className="w-44 shrink-0">
                      <RemoteVideo
                        stream={remoteStream}
                        name={namesById[userId]?.name || `Partisipan ${userId.substring(0, 4)}`}
                        micOn={namesById[userId]?.micOn}
                        handRaised={namesById[userId]?.handRaised}
                        pinned={false}
                        onTogglePin={() => setPinnedId(userId)}
                      />
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <div className="flex-grow flex items-center justify-center min-h-0">
              <div className={`w-full max-w-6xl grid gap-4 items-center justify-center ${
                remoteEntries.length === 0 ? 'grid-cols-1 max-w-3xl' :
                remoteEntries.length === 1 ? 'grid-cols-1 md:grid-cols-2' :
                'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              }`}>
                {renderLocalTile()}
                {remoteEntries.map(([userId, remoteStream]) => (
                  <RemoteVideo
                    key={userId}
                    stream={remoteStream}
                    name={namesById[userId]?.name || `Partisipan ${userId.substring(0, 4)}`}
                    micOn={namesById[userId]?.micOn}
                    handRaised={namesById[userId]?.handRaised}
                    pinned={false}
                    onTogglePin={() => setPinnedId(userId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ajakan berbagi link saat sendirian */}
          {remoteEntries.length === 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#3c4043] rounded-xl shadow-xl px-5 py-4 flex flex-col items-center gap-3 z-20 max-w-[92vw]">
              <p className="text-sm text-gray-200 text-center">Anda satu-satunya di sini. Bagikan link ini untuk mengundang orang lain:</p>
              <div className="flex items-center gap-2 w-full">
                <code className="text-xs bg-black/40 px-3 py-2 rounded-lg truncate flex-grow">{inviteLink}</code>
                <button
                  onClick={copyInviteLink}
                  className="flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#185abc] px-3 py-2 rounded-lg text-sm font-medium transition shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Tersalin!' : 'Salin'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* --- PANEL SAMPING --- */}
        {activePanel && (
          <div className="w-full sm:w-80 md:w-96 bg-white text-[#202124] flex flex-col m-3 ml-0 rounded-2xl overflow-hidden shadow-2xl shrink-0">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium">
                {activePanel === 'chat' && 'Chat dalam rapat'}
                {activePanel === 'people' && `Peserta (${totalParticipants})`}
                {activePanel === 'info' && 'Detail rapat'}
              </h2>
              <button onClick={() => setActivePanel(null)} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* PANEL CHAT */}
            {activePanel === 'chat' && (
              <>
                <div className="flex-grow overflow-y-auto px-4 py-3 space-y-4">
                  {chatMessages.length === 0 && (
                    <p className="text-sm text-gray-400 text-center mt-6">Belum ada pesan.</p>
                  )}
                  {chatMessages.map((msg) => {
                    const mine = msg.senderId === myId;
                    const canDelete = mine || isHost;
                    return (
                      <div key={msg.messageId} className="group">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-[#1a73e8]">
                            {mine ? 'Anda' : msg.senderName}
                          </span>
                          {msg.sentAt && (
                            <span className="text-[11px] text-gray-400">{formatTime(msg.sentAt)}</span>
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-gray-800 break-words whitespace-pre-wrap flex-grow">
                            {msg.text}
                          </p>
                          {canDelete && (
                            <button
                              onClick={() => deleteChat(msg)}
                              title="Hapus pesan"
                              className="opacity-0 group-hover:opacity-100 transition p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-3 border-t border-gray-200 flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                    placeholder="Kirim pesan ke semua orang"
                    className="flex-grow bg-gray-100 rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1a73e8]"
                  />
                  <button
                    onClick={sendChat}
                    disabled={!chatInput.trim()}
                    className={`p-2.5 rounded-full transition ${chatInput.trim() ? 'text-[#1a73e8] hover:bg-blue-50' : 'text-gray-300'}`}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </>
            )}

            {/* PANEL PESERTA */}
            {activePanel === 'people' && (
              <div className="flex-grow overflow-y-auto px-2 py-3 flex flex-col">
                {isHost && participants.length > 1 && (
                  <button
                    onClick={muteAll}
                    className="mx-3 mb-2 flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium text-[#1a73e8]"
                  >
                    <MicOff className="w-4 h-4" /> Bisukan semua
                  </button>
                )}
                {participants.map((p) => {
                  const mine = p.id === myId;
                  return (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-blue-700 text-white flex items-center justify-center text-sm font-medium shrink-0">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {p.name}{mine && ' (Anda)'}
                          </span>
                          {p.isHost && <Crown className="w-4 h-4 text-yellow-500 shrink-0" title="Host" />}
                          {p.handRaised && <Hand className="w-4 h-4 text-yellow-500 shrink-0" title="Mengangkat tangan" />}
                          {p.isSharing && <MonitorUp className="w-4 h-4 text-green-600 shrink-0" title="Berbagi layar" />}
                          {p.micOn === false && <MicOff className="w-4 h-4 text-gray-400 shrink-0" title="Mic mati" />}
                          {p.camOn === false && <VideoOff className="w-4 h-4 text-gray-400 shrink-0" title="Kamera mati" />}
                        </div>
                      </div>

                      {isHost && !mine && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => muteParticipant(p.id)}
                            title="Bisukan peserta"
                            className="p-2 rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                          >
                            <MicOff className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => kickParticipant(p.id)}
                            title="Keluarkan peserta"
                            className="p-2 rounded-full text-red-500 hover:bg-red-50"
                          >
                            <UserX className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {isHost && (
                  <button
                    onClick={endMeetingForAll}
                    className="mt-auto mx-3 mb-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium"
                  >
                    <PhoneOff className="w-4 h-4" /> Akhiri rapat untuk semua
                  </button>
                )}
              </div>
            )}

            {/* PANEL INFO RAPAT */}
            {activePanel === 'info' && (
              <div className="flex-grow overflow-y-auto px-5 py-4 space-y-5">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Link undangan</h3>
                  <code className="block text-xs bg-gray-100 px-3 py-2 rounded-lg break-all">{inviteLink}</code>
                  <button
                    onClick={copyInviteLink}
                    className="mt-2 flex items-center gap-2 bg-[#1a73e8] hover:bg-[#185abc] text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Tersalin!' : 'Salin link undangan'}
                  </button>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Kode rapat</h3>
                  <p className="text-lg tracking-widest font-medium">{roomCode}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Durasi</h3>
                  <p className="text-sm">{formatDuration(elapsed)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Peran Anda</h3>
                  <p className="text-sm">{isHost ? 'Host (moderator rapat)' : 'Peserta'}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- BAR KONTROL BAWAH --- */}
      <div className="h-20 bg-[#202124] px-4 md:px-6 flex items-center justify-between border-t border-gray-800/50 shrink-0">
        <div className="items-center space-x-3 text-sm font-medium text-gray-300 w-1/4 hidden md:flex">
          <span className="tabular-nums">{formatDuration(elapsed)}</span>
          <span className="text-gray-600">|</span>
          <span className="tracking-wider truncate">{roomCode}</span>
        </div>

        <div className="flex items-center justify-center gap-2 md:gap-3 flex-1 md:flex-initial relative">
          <button onClick={toggleMute} title={isMuted ? 'Nyalakan mikrofon' : 'Matikan mikrofon'} className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
            {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
          </button>

          <button onClick={toggleVideo} title={isVideoOff ? 'Nyalakan kamera' : 'Matikan kamera'} className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
            {isVideoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>

          <button onClick={toggleScreenShare} title="Berbagi layar" className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${isSharing ? 'bg-[#1a73e8] hover:bg-[#185abc]' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
            <MonitorUp className="w-5 h-5 text-white" />
          </button>

          <button onClick={toggleHand} title={handRaised ? 'Turunkan tangan' : 'Angkat tangan'} className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${handRaised ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
            <Hand className="w-5 h-5 text-white" />
          </button>

          <div className="relative">
            <button onClick={() => setShowReactionPicker((v) => !v)} title="Kirim reaksi" className={`p-3.5 rounded-full transition-colors duration-200 shadow-md ${showReactionPicker ? 'bg-[#1a73e8]' : 'bg-[#3c4043] hover:bg-[#4a4e52]'}`}>
              <SmilePlus className="w-5 h-5 text-white" />
            </button>
            {showReactionPicker && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-[#3c4043] rounded-full shadow-xl px-3 py-2 flex gap-1 z-40">
                {REACTION_EMOJIS.map((e) => (
                  <button key={e} onClick={() => sendReaction(e)} className="text-2xl hover:scale-125 transition-transform p-1">
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={onLeave} title="Tinggalkan rapat" className="p-3.5 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all duration-200 shadow-md px-6 flex items-center justify-center">
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        <div className="items-center justify-end space-x-1 w-1/4 hidden md:flex text-gray-400">
          <button onClick={toggleFullscreen} title="Layar penuh" className="p-2.5 hover:bg-gray-800 rounded-full transition">
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
          <button
            onClick={() => togglePanel('info')}
            title="Detail rapat"
            className={`p-2.5 rounded-full transition ${activePanel === 'info' ? 'bg-gray-700 text-white' : 'hover:bg-gray-800'}`}
          >
            <Info className="w-5 h-5" />
          </button>
          <button
            onClick={() => togglePanel('people')}
            title="Peserta"
            className={`p-2.5 rounded-full transition relative ${activePanel === 'people' ? 'bg-gray-700 text-white' : 'hover:bg-gray-800'}`}
          >
            <Users className="w-5 h-5" />
            <span className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] px-1 rounded-full">{totalParticipants}</span>
          </button>
          <button
            onClick={() => togglePanel('chat')}
            title="Chat"
            className={`p-2.5 rounded-full transition relative ${activePanel === 'chat' ? 'bg-gray-700 text-white' : 'hover:bg-gray-800'}`}
          >
            <MessageSquare className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[10px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoomView;
