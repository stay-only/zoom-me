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

// Mengizinkan CORS agar klien React (misal port 3000) bisa terhubung ke NestJS (port 5000)
@WebSocketGateway(5000, {
  cors: {
    origin: '*', 
  },
})
export class MeetingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Log ketika ada perangkat baru terhubung ke jaringan WiFi/LAN lokal
  handleConnection(client: Socket) {
    console.log(`Klien terhubung: ${client.id}`);
  }

  // Log dan bersihkan ruangan saat ada user terputus/keluar aplikasi
  handleDisconnect(client: Socket) {
    console.log(`Klien terputus: ${client.id}`);
    
    // Beritahukan ke semua room yang dihuni oleh user ini bahwa dia telah keluar
    // Socket.io secara otomatis menghapus client dari rooms saat disconnect, 
    // jadi kita broadcast manual ke semua entitas yang tersisa jika diperlukan.
    this.server.emit('user-disconnected', { userId: client.id });
  }

  // 1. Menangani Event 'join-room'
  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string },
  ) {
    const { roomCode } = data;
    
    // Masukkan klien ke dalam internal room milik Socket.io
    client.join(roomCode);
    console.log(`User [${client.id}] bergabung ke room: ${roomCode}`);

    // Beritahu user lain yang SUDAH ADA di dalam room tersebut bahwa ada user baru masuk
    // client.to(roomCode) mengirim pesan ke semua orang di room KECUALI pengirim sendiri
    client.to(roomCode).emit('user-joined', { userId: client.id });
  }

  // 2. Meneruskan Offer dari Pengirim ke Target Spesifik
  @SubscribeMessage('send-offer')
  handleSendOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string; offer: any },
  ) {
    const { targetId, offer } = data;
    
    // Kirim langsung ke targetId menggunakan .to()
    this.server.to(targetId).emit('receive-offer', {
      senderId: client.id,
      offer,
    });
  }

  // 3. Meneruskan Answer Balasan ke Pengirim Awal
  @SubscribeMessage('send-answer')
  handleSendAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string; answer: any },
  ) {
    const { targetId, answer } = data;
    
    this.server.to(targetId).emit('receive-answer', {
      senderId: client.id,
      answer,
    });
  }

  // 4. Meneruskan ICE Candidate (Jalur Koneksi P2P Terbaik)
  @SubscribeMessage('send-ice-candidate')
  handleSendIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId: string; candidate: any },
  ) {
    const { targetId, candidate } = data;
    
    this.server.to(targetId).emit('receive-ice-candidate', {
      senderId: client.id,
      candidate,
    });
  }
}