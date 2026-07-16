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
      }
    }
    this.broadcastParticipants(roomCode);
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

    this.server.to(sender.roomCode).emit('chat-message', {
      messageId: data.messageId,
      senderId: client.id,
      senderName: sender.name,
      text,
      sentAt: Date.now(),
    });
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
    this.roomHosts.delete(roomCode);
  }
}
