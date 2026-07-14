import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { MeetingService, Meeting } from './meeting.service';

@Controller('api/meetings')
export class MeetingController {
  constructor(private meetingService: MeetingService) {}

  @Post('create')
  createMeeting(@Body() body: { userId: string }) {
    const meeting = this.meetingService.createMeeting(body.userId);
    return {
      success: true,
      data: meeting,
      message: 'Rapat berhasil dibuat',
    };
  }

  @Post('join')
  joinMeeting(@Body() body: { code: string; userId: string }) {
    const result = this.meetingService.joinMeeting(body.code, body.userId);
    return result;
  }

  @Get(':id')
  getMeeting(@Param('id') id: string) {
    const meeting = this.meetingService.getMeeting(id);
    if (!meeting) {
      return {
        success: false,
        message: 'Rapat tidak ditemukan',
      };
    }
    return {
      success: true,
      data: meeting,
    };
  }

  @Post(':id/end')
  endMeeting(@Param('id') id: string) {
    const success = this.meetingService.endMeeting(id);
    if (success) {
      return {
        success: true,
        message: 'Rapat berhasil diakhiri',
      };
    }
    return {
      success: false,
      message: 'Rapat tidak ditemukan',
    };
  }
}
