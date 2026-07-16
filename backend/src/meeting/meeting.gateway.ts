// src/meeting/meeting.gateway.ts
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface Participant {
  id: string;
  name: string;
  roomCode: string;
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  isSharing: boolean;
}

// Gateway TANPA port khusus: Socket.IO menempel di server HTTP utama (port 3000).
// Dengan begitu frontend & signaling berbagi SATU origin — tidak ada lagi
// ketergantungan pada port kedua yang bisa gagal di-forward/public.
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MeetingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Menyimpan data setiap peserta yang terhubung berdasarkan socket id
  private participants: Map<string, Participant> = new Map();

  // Menyimpan socket id host untuk tiap room (orang pertama yang membuat room)
  private roomHosts: Map<string, string> = new Map();

  // Room yang dikunci host: peserta baru tidak bisa bergabung
  private lockedRooms: Set<string> = new Set();

  // Room dengan ruang tunggu aktif: peserta baru menunggu persetujuan host
  private waitingRooms: Set<string> = new Set();

  // Peserta yang sedang menunggu persetujuan, keyed by socket id
  private pendingJoins: Map<string, { roomCode: string; userName: string }> =
    new Map();

  // Riwayat chat per room (maks 100 pesan) agar peserta baru ikut melihatnya
  private roomMessages: Map<
    string,
    {
      messageId: string;
      senderId: string;
      senderName: string;
      text: string;
      sentAt: number;
    }[]
  > = new Map();

  // Kode rapat dibuat case-insensitive & bebas spasi agar "ABC-123" == "abc-123 "
  private normalizeRoomCode(code: string): string {
    return (code || '').trim().toLowerCase();
  }

  // Ambil data peserta pengirim; semua handler memakai room yang TERSIMPAN di
  // server, bukan roomCode kiriman klien, supaya tidak bisa dipalsukan.
  private senderOf(client: Socket): Participant | undefined {
    return this.participants.get(client.id);
  }

  handleConnection(client: Socket) {
    console.log(`Klien terhubung: ${client.id}`);
  }

  // Saat user terputus, bersihkan data & beritahu HANYA anggota room yang sama
  handleDisconnect(client: Socket) {
    console.log(`Klien terputus: ${client.id}`);

    // Sedang menunggu di ruang tunggu? Batalkan permintaannya di layar host
    const pending = this.pendingJoins.get(client.id);
    if (pending) {
      this.pendingJoins.delete(client.id);
      const hostId = this.roomHosts.get(pending.roomCode);
      if (hostId) {
        this.server
          .to(hostId)
          .emit('join-request-cancelled', { userId: client.id });
      }
    }

    this.removeParticipant(client.id);
  }

  private removeParticipant(clientId: string) {
    const participant = this.participants.get(clientId);
    if (!participant) return;

    const { roomCode, name } = participant;

    // Broadcast hanya ke anggota room yang tersisa, bukan ke semua koneksi global
    this.server
      .to(roomCode)
      .except(clientId)
      .emit('user-disconnected', { userId: clientId, userName: name });

    this.participants.delete(clientId);

    // Jika host keluar, tunjuk host baru dari peserta tersisa (jika ada)
    if (this.roomHosts.get(roomCode) === clientId) {
      this.roomHosts.delete(roomCode);
      const remaining = [...this.participants.values()].find(
        (p) => p.roomCode === roomCode,
      );
      if (remaining) {
        remaining.isHost = true;
        this.roomHosts.set(roomCode, remaining.id);
        this.server.to(roomCode).emit('host-changed', {
          hostId: remaining.id,
          hostName: remaining.name,
        });
        // Host baru mewarisi antrean ruang tunggu yang masih menunggu
        for (const [id, pending] of this.pendingJoins.entries()) {
          if (pending.roomCode === roomCode) {
            this.server.to(remaining.id).emit('join-request', {
              userId: id,
              userName: pending.userName,
            });
          }
        }
      }
    }

    // Room kosong? Bersihkan seluruh state-nya (termasuk status terkunci)
    const stillOccupied = [...this.participants.values()].some(
      (p) => p.roomCode === roomCode,
    );
    if (!stillOccupied) {
      this.cleanupRoom(roomCode);
    }

    this.broadcastParticipants(roomCode);
  }

  // Bersihkan seluruh state sebuah room (dipanggil saat room kosong/berakhir)
  private cleanupRoom(roomCode: string) {
    this.roomHosts.delete(roomCode);
    this.lockedRooms.delete(roomCode);
    this.waitingRooms.delete(roomCode);
    this.roomMessages.delete(roomCode);
    // Yang masih menunggu di ruang tunggu: tolak dengan alasan room berakhir
    for (const [id, pending] of [...this.pendingJoins.entries()]) {
      if (pending.roomCode === roomCode) {
        this.pendingJoins.delete(id);
        this.server.to(id).emit('join-denied', { reason: 'room-closed' });
      }
    }
  }

  // Kirim daftar peserta terbaru ke seluruh anggota room
  private broadcastParticipants(roomCode: string) {
    const list = [...this.participants.values()]
      .filter((p) => p.roomCode === roomCode)
      .map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        micOn: p.micOn,
        camOn: p.camOn,
        handRaised: p.handRaised,
        isSharing: p.isSharing,
      }));
    this.server
      .to(roomCode)
      .emit('participants-updated', { participants: list });
  }

  // Pastikan hanya host yang boleh melakukan aksi moderasi
  private isHost(client: Socket): boolean {
    const sender = this.senderOf(client);
    if (!sender) return false;
    return this.roomHosts.get(sender.roomCode) === client.id;
  }

  // 1. Menangani Event 'join-room'
  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; userName?: string },
  ) {
    const roomCode = this.normalizeRoomCode(data.roomCode);
    if (!roomCode) return;

    const userName =
      (data.userName || '').trim().substring(0, 40) ||
      `Tamu ${client.id.substring(0, 4)}`;

    // Room terkunci: tolak peserta baru (host mengunci dari panel peserta)
    if (this.lockedRooms.has(roomCode)) {
      client.emit('join-denied', { reason: 'locked' });
      return;
    }

    // Ruang tunggu aktif & sudah ada host: tahan dulu, minta persetujuan host
    if (this.waitingRooms.has(roomCode) && this.roomHosts.has(roomCode)) {
      this.pendingJoins.set(client.id, { roomCode, userName });
      client.emit('waiting-approval', { roomCode });
      const hostId = this.roomHosts.get(roomCode);
      if (hostId) {
        this.server
          .to(hostId)
          .emit('join-request', { userId: client.id, userName });
      }
      return;
    }

    this.completeJoin(client, roomCode, userName);
  }

  // Proses join sesungguhnya (dipanggil langsung, atau setelah host mengizinkan)
  private completeJoin(client: Socket, roomCode: string, userName: string) {
    void client.join(roomCode);

    // Orang pertama yang masuk room menjadi host
    const isHost = !this.roomHosts.has(roomCode);
    if (isHost) {
      this.roomHosts.set(roomCode, client.id);
    }

    this.participants.set(client.id, {
      id: client.id,
      name: userName,
      roomCode,
      isHost,
      micOn: true,
      camOn: true,
      handRaised: false,
      isSharing: false,
    });

    console.log(
      `User [${userName} / ${client.id}] bergabung ke room: ${roomCode}${isHost ? ' (HOST)' : ''}`,
    );

    // Beri tahu klien identitasnya sendiri (id + status host + kode ternormalisasi)
    client.emit('joined', {
      userId: client.id,
      isHost,
      hostId: this.roomHosts.get(roomCode),
      roomCode,
    });

    // Kirim riwayat chat agar peserta baru ikut melihat percakapan sebelumnya
    const history = this.roomMessages.get(roomCode);
    if (history && history.length > 0) {
      client.emit('chat-history', { messages: history });
    }

    // Beri tahu peserta lama bahwa ada user baru (memicu WebRTC offer). Sertakan nama.
    client.to(roomCode).emit('user-joined', { userId: client.id, userName });

    // Kirim daftar peserta terbaru ke semua orang di room
    this.broadcastParticipants(roomCode);
  }

  // 2. Meneruskan Offer ke target spesifik (sertakan nama pengirim)
  @SubscribeMessage('send-offer')
  handleSendOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string; offer: unknown },
  ) {
    const sender = this.senderOf(client);
    this.server.to(data.targetId).emit('receive-offer', {
      senderId: client.id,
      senderName: sender?.name,
      offer: data.offer,
    });
  }

  // 3. Meneruskan Answer ke pengirim awal
  @SubscribeMessage('send-answer')
  handleSendAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string; answer: unknown },
  ) {
    this.server.to(data.targetId).emit('receive-answer', {
      senderId: client.id,
      answer: data.answer,
    });
  }

  // 4. Meneruskan ICE Candidate
  @SubscribeMessage('send-ice-candidate')
  handleSendIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string; candidate: unknown },
  ) {
    this.server.to(data.targetId).emit('receive-ice-candidate', {
      senderId: client.id,
      candidate: data.candidate,
    });
  }

  // ---------- FITUR CHAT ----------

  // Kirim pesan chat ke seluruh anggota room
  @SubscribeMessage('chat-message')
  handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; text: string },
  ) {
    const sender = this.senderOf(client);
    if (!sender) return;

    const text = (data.text || '').substring(0, 2000);
    if (!text.trim()) return;

    const msg = {
      messageId: data.messageId,
      senderId: client.id,
      senderName: sender.name,
      text,
      sentAt: Date.now(),
    };

    // Simpan ke riwayat room (maks 100 pesan terakhir)
    const history = this.roomMessages.get(sender.roomCode) ?? [];
    history.push(msg);
    if (history.length > 100) history.shift();
    this.roomMessages.set(sender.roomCode, history);

    this.server.to(sender.roomCode).emit('chat-message', msg);
  }

  // Hapus pesan chat. Pengirim boleh hapus pesannya sendiri; host boleh hapus pesan siapa pun.
  @SubscribeMessage('delete-message')
  handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; ownerId: string },
  ) {
    const sender = this.senderOf(client);
    if (!sender) return;

    const isOwner = data.ownerId === client.id;
    if (!isOwner && !this.isHost(client)) return;

    // Hapus juga dari riwayat agar peserta baru tidak melihat pesan terhapus
    const history = this.roomMessages.get(sender.roomCode);
    if (history) {
      this.roomMessages.set(
        sender.roomCode,
        history.filter((m) => m.messageId !== data.messageId),
      );
    }

    this.server.to(sender.roomCode).emit('message-deleted', {
      messageId: data.messageId,
    });
  }

  // ---------- STATUS MEDIA & BERBAGI LAYAR ----------

  // Peserta melaporkan status mic/kamera agar daftar peserta akurat (ala Meet)
  @SubscribeMessage('media-state')
  handleMediaState(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { micOn?: boolean; camOn?: boolean },
  ) {
    const sender = this.senderOf(client);
    if (!sender) return;
    if (typeof data.micOn === 'boolean') sender.micOn = data.micOn;
    if (typeof data.camOn === 'boolean') sender.camOn = data.camOn;
    this.broadcastParticipants(sender.roomCode);
  }

  // Beritahu anggota room bahwa seseorang mulai/berhenti berbagi layar
  @SubscribeMessage('screen-share')
  handleScreenShare(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sharing: boolean },
  ) {
    const sender = this.senderOf(client);
    if (!sender) return;
    sender.isSharing = !!data.sharing;
    client.to(sender.roomCode).emit('screen-share', {
      userId: client.id,
      userName: sender.name,
      sharing: sender.isSharing,
    });
    this.broadcastParticipants(sender.roomCode);
  }

  // ---------- ANGKAT TANGAN & REAKSI ----------

  @SubscribeMessage('raise-hand')
  handleRaiseHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { raised: boolean },
  ) {
    const sender = this.senderOf(client);
    if (!sender) return;
    sender.handRaised = !!data.raised;
    this.server.to(sender.roomCode).emit('hand-raised', {
      userId: client.id,
      userName: sender.name,
      raised: sender.handRaised,
    });
    this.broadcastParticipants(sender.roomCode);
  }

  // Reaksi emoji sekilas (👍 ❤️ 😂 dsb.) — hanya diteruskan, tidak disimpan
  @SubscribeMessage('reaction')
  handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { emoji: string },
  ) {
    const sender = this.senderOf(client);
    if (!sender) return;
    const emoji = (data.emoji || '').substring(0, 8);
    if (!emoji) return;
    this.server.to(sender.roomCode).emit('reaction', {
      userId: client.id,
      userName: sender.name,
      emoji,
    });
  }

  // ---------- FITUR MODERASI PARTICIPANT (HOST ONLY) ----------

  // Host membisukan seorang peserta (memaksa mute di sisi peserta target)
  @SubscribeMessage('mute-participant')
  handleMuteParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    if (!this.isHost(client)) return;
    const sender = this.senderOf(client);
    const target = this.participants.get(data.targetId);
    if (!sender || !target || target.roomCode !== sender.roomCode) return;
    this.server.to(data.targetId).emit('force-mute');
  }

  // Host membisukan SEMUA peserta lain sekaligus (ala Zoom "Mute All")
  @SubscribeMessage('mute-all')
  handleMuteAll(@ConnectedSocket() client: Socket) {
    if (!this.isHost(client)) return;
    const sender = this.senderOf(client);
    if (!sender) return;
    this.server.to(sender.roomCode).except(client.id).emit('force-mute');
  }

  // Validasi umum aksi host terhadap satu target di room yang sama
  private hostTarget(
    client: Socket,
    targetId: string,
  ): { host: Participant; target: Participant } | null {
    if (!this.isHost(client)) return null;
    const host = this.senderOf(client);
    const target = this.participants.get(targetId);
    if (!host || !target || target.roomCode !== host.roomCode) return null;
    return { host, target };
  }

  // Host MEMINTA peserta menyalakan mikrofon (perlu persetujuan peserta, ala Zoom)
  @SubscribeMessage('request-unmute')
  handleRequestUnmute(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    const pair = this.hostTarget(client, data.targetId);
    if (!pair) return;
    this.server
      .to(data.targetId)
      .emit('unmute-requested', { hostName: pair.host.name });
  }

  // Host mematikan kamera seorang peserta (langsung, tanpa persetujuan)
  @SubscribeMessage('camera-off-participant')
  handleCameraOffParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    const pair = this.hostTarget(client, data.targetId);
    if (!pair) return;
    this.server.to(data.targetId).emit('force-camera-off');
  }

  // Host MEMINTA peserta menyalakan kamera (perlu persetujuan peserta)
  @SubscribeMessage('request-camera-on')
  handleRequestCameraOn(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    const pair = this.hostTarget(client, data.targetId);
    if (!pair) return;
    this.server
      .to(data.targetId)
      .emit('camera-on-requested', { hostName: pair.host.name });
  }

  // Host mengaktifkan/mematikan ruang tunggu
  @SubscribeMessage('toggle-waiting-room')
  handleToggleWaitingRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { enabled: boolean },
  ) {
    if (!this.isHost(client)) return;
    const sender = this.senderOf(client);
    if (!sender) return;
    if (data.enabled) this.waitingRooms.add(sender.roomCode);
    else this.waitingRooms.delete(sender.roomCode);
    this.server.to(sender.roomCode).emit('waiting-room-changed', {
      enabled: !!data.enabled,
      byName: sender.name,
    });
    // Ruang tunggu dimatikan: langsung masukkan semua yang sedang menunggu
    if (!data.enabled) {
      for (const [id, pending] of [...this.pendingJoins.entries()]) {
        if (pending.roomCode !== sender.roomCode) continue;
        const sock = this.server.sockets.sockets.get(id);
        this.pendingJoins.delete(id);
        if (sock) this.completeJoin(sock, pending.roomCode, pending.userName);
      }
    }
  }

  // Host mengizinkan peserta yang menunggu untuk masuk
  @SubscribeMessage('admit-participant')
  handleAdmitParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    if (!this.isHost(client)) return;
    const host = this.senderOf(client);
    const pending = this.pendingJoins.get(data.targetId);
    if (!host || !pending || pending.roomCode !== host.roomCode) return;

    const sock = this.server.sockets.sockets.get(data.targetId);
    this.pendingJoins.delete(data.targetId);
    if (sock) this.completeJoin(sock, pending.roomCode, pending.userName);
  }

  // Host menolak peserta yang menunggu
  @SubscribeMessage('deny-participant')
  handleDenyParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    if (!this.isHost(client)) return;
    const host = this.senderOf(client);
    const pending = this.pendingJoins.get(data.targetId);
    if (!host || !pending || pending.roomCode !== host.roomCode) return;

    this.pendingJoins.delete(data.targetId);
    this.server.to(data.targetId).emit('join-denied', { reason: 'denied' });
  }

  // Host mengunci/membuka room: saat terkunci, peserta baru ditolak
  @SubscribeMessage('lock-meeting')
  handleLockMeeting(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { locked: boolean },
  ) {
    if (!this.isHost(client)) return;
    const sender = this.senderOf(client);
    if (!sender) return;
    if (data.locked) this.lockedRooms.add(sender.roomCode);
    else this.lockedRooms.delete(sender.roomCode);
    this.server.to(sender.roomCode).emit('meeting-locked', {
      locked: !!data.locked,
      byName: sender.name,
    });
  }

  // Host mengeluarkan seorang peserta dari room
  @SubscribeMessage('kick-participant')
  handleKickParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string },
  ) {
    if (!this.isHost(client)) return;
    const sender = this.senderOf(client);
    const targetInfo = this.participants.get(data.targetId);
    if (!sender || !targetInfo || targetInfo.roomCode !== sender.roomCode)
      return;

    const target = this.server.sockets.sockets.get(data.targetId);

    // Beri tahu target bahwa ia dikeluarkan, lalu paksa keluar dari room
    this.server.to(data.targetId).emit('kicked');
    if (target) void target.leave(targetInfo.roomCode);

    // Bersihkan data peserta & beritahu yang tersisa
    this.removeParticipant(data.targetId);
  }

  // Host mengakhiri rapat untuk SEMUA peserta (ala Zoom "End meeting for all")
  @SubscribeMessage('end-meeting')
  handleEndMeeting(@ConnectedSocket() client: Socket) {
    if (!this.isHost(client)) return;
    const sender = this.senderOf(client);
    if (!sender) return;

    const { roomCode } = sender;
    this.server.to(roomCode).emit('meeting-ended');

    // Bersihkan seluruh data room
    for (const [id, p] of [...this.participants.entries()]) {
      if (p.roomCode === roomCode) {
        const sock = this.server.sockets.sockets.get(id);
        if (sock) void sock.leave(roomCode);
        this.participants.delete(id);
      }
    }
    this.cleanupRoom(roomCode);
  }
}
