import { Injectable } from '@nestjs/common';

export interface Meeting {
  id: string;
  code: string;
  createdAt: Date;
  createdBy: string;
  participants: string[];
  status: 'active' | 'ended';
}

@Injectable()
export class MeetingService {
  private meetings: Map<string, Meeting> = new Map();

  generateMeetingCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  createMeeting(userId: string): { id: string; code: string } {
    const code = this.generateMeetingCode();
    const id = this.generateMeetingCode().replace('-', '');

    const meeting: Meeting = {
      id,
      code,
      createdAt: new Date(),
      createdBy: userId,
      participants: [userId],
      status: 'active',
    };

    this.meetings.set(id, meeting);
    return { id, code };
  }

  joinMeeting(meetingCode: string, userId: string): { success: boolean; message: string; meetingId?: string } {
    for (const [id, meeting] of this.meetings.entries()) {
      if (meeting.code === meetingCode) {
        if (meeting.status === 'active') {
          if (!meeting.participants.includes(userId)) {
            meeting.participants.push(userId);
          }
          return { success: true, message: 'Berhasil bergabung dengan rapat', meetingId: id };
        } else {
          return { success: false, message: 'Rapat telah berakhir' };
        }
      }
    }
    return { success: false, message: 'Kode rapat tidak ditemukan' };
  }

  getMeeting(meetingId: string): Meeting | null {
    return this.meetings.get(meetingId) || null;
  }

  endMeeting(meetingId: string): boolean {
    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      meeting.status = 'ended';
      return true;
    }
    return false;
  }
}
