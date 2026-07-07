import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/roles.decorator';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import {
  CreateConversationDto,
  CreateConversationResponseDto,
} from './dto/create-conversation.dto';
import {
  EditMessageDto,
  MessageResponseDto,
  SendMessageDto,
} from './dto/send-message.dto';
import { ChatQueryDto } from './dto/chat-query.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Conversations
  // ─────────────────────────────────────────────────────────────────────────

  @Post('conversations')
  @ApiOperation({
    summary: 'Start or retrieve a 1-on-1 conversation with another user',
    description:
      'Creates a new conversation if none exists between the two users, otherwise returns the existing one.',
  })
  @ApiResponse({
    status: 201,
    description: 'Conversation created or retrieved.',
    type: CreateConversationResponseDto,
  })
  async createConversation(
    @CurrentUser() user: { userId: string; role: Role },
    @Body() dto: CreateConversationDto,
  ) {
    const { conversation, isNew } =
      await this.chatService.findOrCreateConversation(user.userId, user.role, dto);

    return {
      success: true,
      message: isNew
        ? 'Conversation created successfully'
        : 'Existing conversation retrieved',
      data: conversation,
    };
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'Get all conversations for the current user',
    description:
      'Returns all conversations with last message preview and unread count, ordered by most recent.',
  })
  @ApiResponse({ status: 200, description: 'Conversations retrieved.' })
  async getMyConversations(@CurrentUser() user: { userId: string; role: Role }) {
    const conversations = await this.chatService.getMyConversations(
      user.userId,
      user.role,
    );
    return {
      success: true,
      data: conversations,
    };
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'Get a single conversation by ID' })
  @ApiParam({ name: 'conversationId', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Conversation retrieved.' })
  @ApiResponse({ status: 403, description: 'Not a participant.' })
  @ApiResponse({ status: 404, description: 'Conversation not found.' })
  async getConversation(
    @CurrentUser() user: { userId: string; role: Role },
    @Param('conversationId') conversationId: string,
  ) {
    const conversation = await this.chatService.getConversationById(
      conversationId,
      user.userId,
      user.role,
    );
    return { success: true, data: conversation };
  }

  @Patch('conversations/:conversationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a conversation as read' })
  @ApiParam({ name: 'conversationId', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Marked as read.' })
  async markAsRead(
    @CurrentUser() user: { userId: string; role: Role },
    @Param('conversationId') conversationId: string,
  ) {
    await this.chatService.markAsRead(conversationId, user.userId, user.role);
    return { success: true, message: 'Conversation marked as read' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Messages
  // ─────────────────────────────────────────────────────────────────────────

  @Post('conversations/:conversationId/messages')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiOperation({
    summary: 'Send a message via REST (WebSocket fallback)',
    description:
      'Send a message using HTTP. The message is also broadcasted to WebSocket clients in the conversation room.',
  })
  @ApiParam({ name: 'conversationId', description: 'Conversation UUID' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', example: 'Hello everyone' },
        messageType: {
          type: 'string',
          enum: ['TEXT', 'IMAGE', 'FILE'],
          example: 'FILE',
        },
        fileUrl: {
          type: 'string',
          example: 'https://storage.example.com/files/lesson.pdf',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Optional attachment. If sent, uploaded to S3.',
        },
      },
    },
    examples: {
      text: {
        summary: 'Text message',
        value: {
          content: 'Hello everyone',
          messageType: 'TEXT',
        },
      },
      image: {
        summary: 'Image message',
        value: {
          content: 'Class screenshot',
          messageType: 'IMAGE',
          fileUrl: 'https://storage.example.com/images/class.png',
        },
      },
      pdf: {
        summary: 'PDF or file message',
        value: {
          content: 'Today lesson PDF',
          messageType: 'FILE',
          fileUrl: 'https://storage.example.com/files/lesson.pdf',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Message sent.',
    type: MessageResponseDto,
  })
  async sendMessage(
    @CurrentUser() user: { userId: string; role: Role },
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @UploadedFile() file?: any,
  ) {
    const message = await this.chatService.sendMessage(
      conversationId,
      user.userId,
      user.role,
      dto,
      file,
    );

    // Also broadcast to WebSocket room so real-time clients receive it
    this.chatGateway.emitNewMessage(conversationId, message);

    return {
      success: true,
      message: 'Message sent successfully',
      data: message,
    };
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'Get paginated messages for a conversation',
    description:
      'Returns messages in chronological order using cursor-based pagination. Pass `cursor` (message ID) to load older messages.',
  })
  @ApiParam({ name: 'conversationId', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Messages retrieved.' })
  async getMessages(
    @CurrentUser() user: { userId: string; role: Role },
    @Param('conversationId') conversationId: string,
    @Query() query: ChatQueryDto,
  ) {
    const result = await this.chatService.getMessages(
      conversationId,
      user.userId,
      user.role,
      query,
    );
    return { success: true, data: result };
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message (sender only)' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiResponse({ status: 200, description: 'Message edited.' })
  @ApiResponse({ status: 403, description: 'Not the message sender.' })
  async editMessage(
    @CurrentUser() user: { userId: string; role: Role },
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    const message = await this.chatService.editMessage(
      messageId,
      user.userId,
      user.role,
      dto,
    );
    return {
      success: true,
      message: 'Message updated successfully',
      data: message,
    };
  }

  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a message (sender only)' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiResponse({ status: 200, description: 'Message deleted.' })
  @ApiResponse({ status: 403, description: 'Not the message sender.' })
  async deleteMessage(
    @CurrentUser() user: { userId: string; role: Role },
    @Param('messageId') messageId: string,
  ) {
    await this.chatService.deleteMessage(messageId, user.userId, user.role);
    return { success: true, message: 'Message deleted successfully' };
  }
}
