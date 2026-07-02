require('dotenv/config');

const bcrypt = require('bcrypt');
const { PrismaClient, Role } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const STUDENT_ID = 'a9177f21-01f3-424b-ace5-48b1d73cca91';
const TUTOR_ID = '33333333-3333-4333-8333-333333333333';
const COURSE_ID = '44444444-4444-4444-8444-444444444444';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function getDhakaNow() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter
    .formatToParts(new Date())
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});

  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+06:00`,
  );
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

async function main() {
  const dhakaNow = getDhakaNow();
  const lessonStartsAt = new Date(dhakaNow.getTime() + 30 * 60 * 1000);
  const lessonDate = new Date(lessonStartsAt);
  lessonDate.setHours(0, 0, 0, 0);
  const lessonTime = formatTime(lessonStartsAt).toLowerCase();

  const studentPasswordHash = await bcrypt.hash('student123', 10);
  const tutorPasswordHash = await bcrypt.hash('password123', 10);

  await prisma.user.upsert({
    where: { id: STUDENT_ID },
    update: {
      fullName: 'Istiak Turjo',
      email: 'student@gmail.com',
      password: studentPasswordHash,
      role: Role.STUDENT,
      isEmailVerified: true,
      notifyLessonReminders: true,
    },
    create: {
      id: STUDENT_ID,
      fullName: 'Istiak Turjo',
      email: 'student@gmail.com',
      password: studentPasswordHash,
      role: Role.STUDENT,
      isEmailVerified: true,
      notifyLessonReminders: true,
      profile: {
        create: {
          avatarUrl:
            'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
          applicationStatus: 'APPROVED',
        },
      },
    },
  });

  await prisma.user.upsert({
    where: { id: TUTOR_ID },
    update: {
      fullName: 'Alert Test Tutor',
      email: 'alert.tutor@daan.test',
      password: tutorPasswordHash,
      role: Role.TUTOR,
      isEmailVerified: true,
    },
    create: {
      id: TUTOR_ID,
      fullName: 'Alert Test Tutor',
      email: 'alert.tutor@daan.test',
      password: tutorPasswordHash,
      role: Role.TUTOR,
      isEmailVerified: true,
    },
  });

  await prisma.userProfile.upsert({
    where: { userId: TUTOR_ID },
    update: {
      avatarUrl:
        'https://images.unsplash.com/photo-1531891437562-4301cf35b7e4?w=240&h=240&fit=crop',
      bio: 'Dedicated test tutor for lesson reminder validation.',
      yearOfExperience: 5,
      teachingCategory: 'Programming',
      teachingSkills: ['JavaScript', 'Testing'],
      applicationStatus: 'APPROVED',
      averageRating: 5,
      totalReviews: 0,
    },
    create: {
      userId: TUTOR_ID,
      avatarUrl:
        'https://images.unsplash.com/photo-1531891437562-4301cf35b7e4?w=240&h=240&fit=crop',
      bio: 'Dedicated test tutor for lesson reminder validation.',
      yearOfExperience: 5,
      teachingCategory: 'Programming',
      teachingSkills: ['JavaScript', 'Testing'],
      applicationStatus: 'APPROVED',
      averageRating: 5,
      totalReviews: 0,
    },
  });

  await prisma.course.upsert({
    where: { id: COURSE_ID },
    update: {
      tutorId: TUTOR_ID,
      title: 'Reminder Alert Test Class',
      category: 'Programming',
      description: 'Single lesson course created to test 30-minute dashboard alerts.',
      extraInfos: ['Test data', 'Student dashboard alert'],
      topics: ['Dashboard reminders'],
      requirement: 'No requirement',
      image:
        'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=640&h=360&fit=crop',
      curriculums: ['Reminder Alert Lesson'],
      startDate: lessonDate,
      time: lessonTime,
      timeZone: 'Asia/Dhaka',
      classDuration: 60,
      language: 'English',
      courseDuration: 1,
      pricePerStudent: 25,
      minStudent: 1,
      maxStudent: 5,
      enrollmentDeadline: new Date(lessonStartsAt.getTime() + 24 * 60 * 60 * 1000),
    },
    create: {
      id: COURSE_ID,
      tutorId: TUTOR_ID,
      title: 'Reminder Alert Test Class',
      category: 'Programming',
      description: 'Single lesson course created to test 30-minute dashboard alerts.',
      extraInfos: ['Test data', 'Student dashboard alert'],
      topics: ['Dashboard reminders'],
      requirement: 'No requirement',
      image:
        'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=640&h=360&fit=crop',
      curriculums: ['Reminder Alert Lesson'],
      startDate: lessonDate,
      time: lessonTime,
      timeZone: 'Asia/Dhaka',
      classDuration: 60,
      language: 'English',
      courseDuration: 1,
      pricePerStudent: 25,
      minStudent: 1,
      maxStudent: 5,
      enrollmentDeadline: new Date(lessonStartsAt.getTime() + 24 * 60 * 60 * 1000),
    },
  });

  await prisma.curriculum.deleteMany({
    where: { courseId: COURSE_ID },
  });

  await prisma.curriculum.create({
    data: {
      courseId: COURSE_ID,
      title: 'Reminder Alert Lesson',
      date: lessonDate,
      time: lessonTime,
    },
  });

  await prisma.courseEnrollment.upsert({
    where: {
      courseId_studentId: {
        courseId: COURSE_ID,
        studentId: STUDENT_ID,
      },
    },
    update: {},
    create: {
      courseId: COURSE_ID,
      studentId: STUDENT_ID,
    },
  });

  await prisma.curriculumProgress.deleteMany({
    where: {
      courseId: COURSE_ID,
      studentId: STUDENT_ID,
    },
  });

  await prisma.courseCompletion.deleteMany({
    where: {
      courseId: COURSE_ID,
      studentId: STUDENT_ID,
    },
  });

  await prisma.studentLessonState.deleteMany({
    where: {
      courseId: COURSE_ID,
      studentId: STUDENT_ID,
    },
  });

  console.log('Seeded reminder alert test data for student@gmail.com');
  console.log(`Lesson date: ${lessonDate.toISOString()}`);
  console.log(`Lesson time (Asia/Dhaka): ${lessonTime}`);
  console.log(`Starts at (ISO): ${lessonStartsAt.toISOString()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
