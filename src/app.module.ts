import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MailModule } from './modules/common/mail/mail.module';
import { S3StorageModule } from './modules/common/s3/s3.module';
import { ProfileModule } from './modules/profile/profile.module';
import { CourseModule } from './modules/course/course.module';
import { ResourceModule } from './modules/resource/resource.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ChatModule } from './modules/chat/chat.module';
import { ReviewModule } from './modules/review/review.module';
import { RedisModule } from './modules/common/redis/redis.module';
import { ContactModule } from './modules/contact/contact.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ClassesModule } from './modules/classes/classes.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AdminDashboardModule } from './modules/admindashboard/admindashboard.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AgoraModule } from './modules/agora/agora.module';
import { StudentLessonsModule } from './modules/student-lessons/student-lessons.module';
import { LiveClassMessageModule } from './modules/live-class-message/live-class-message.module';
import { UploadModule } from './modules/upload/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    S3StorageModule,
    AuthModule,
    UsersModule,
    MailModule,
    ProfileModule,
    CourseModule,
    ResourceModule,
    SettingsModule,
    ChatModule,
    ReviewModule,
    ContactModule,
    PaymentModule,
    ClassesModule,
    DashboardModule,
    AdminDashboardModule,
    CalendarModule,
    NotificationModule,
    AgoraModule,
    StudentLessonsModule,
    LiveClassMessageModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
