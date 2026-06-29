require('dotenv/config');

const bcrypt = require('bcrypt');
const {
  ApplicationStatus,
  DayOfWeek,
  PaymentStatus,
  PaymentType,
  PayoutStatus,
  PrismaClient,
  Role,
} = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = 'student123';
const TUTOR_ID = '82000000-0000-4000-8000-000000000001';
const STUDENT_ID = '82000000-0000-4000-8000-000000000002';
const CHECKOUT_COURSE_ID = '82000000-0000-4000-8000-000000000101';
const UPCOMING_COURSE_ID = '82000000-0000-4000-8000-000000000102';
const COMPLETED_COURSE_ID = '82000000-0000-4000-8000-000000000103';

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function payoutSplit(amount) {
  const commissionRate = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.2);
  const commissionAmount = Number((amount * commissionRate).toFixed(2));
  const tutorAmount = Number((amount - commissionAmount).toFixed(2));

  return {
    commissionRate,
    commissionAmount,
    tutorAmount,
  };
}

async function upsertUser({ id, fullName, email, role }) {
  const password = await bcrypt.hash(PASSWORD, 10);

  return prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      password,
      role,
      isEmailVerified: true,
    },
    create: {
      id,
      fullName,
      email,
      password,
      role,
      isEmailVerified: true,
    },
  });
}

async function upsertProfile(userId, data) {
  const { education, availability, ...profileData } = data;
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: profileData,
    create: {
      userId,
      ...profileData,
    },
  });

  if (education) {
    await prisma.education.deleteMany({ where: { profileId: profile.id } });
    await prisma.education.createMany({
      data: education.map((item) => ({
        profileId: profile.id,
        ...item,
      })),
    });
  }

  if (availability) {
    await prisma.availability.deleteMany({ where: { profileId: profile.id } });
    await prisma.availability.createMany({
      data: availability.map((item) => ({
        profileId: profile.id,
        ...item,
      })),
    });
  }

  return profile;
}

async function upsertCourse(course) {
  const baseData = {
    tutorId: course.tutorId,
    title: course.title,
    category: course.category,
    description: course.description,
    extraInfos: course.extraInfos,
    topics: course.topics,
    requirement: course.requirement,
    image: course.image,
    curriculums: course.curriculums.map((item) => item.title),
    startDate: course.startDate,
    time: course.time,
    timeZone: course.timeZone,
    classDuration: course.classDuration,
    language: course.language,
    courseDuration: course.curriculums.length,
    pricePerStudent: course.pricePerStudent,
    minStudent: course.minStudent,
    maxStudent: course.maxStudent,
    enrollmentDeadline: course.enrollmentDeadline,
  };

  await prisma.course.upsert({
    where: { id: course.id },
    update: baseData,
    create: {
      id: course.id,
      ...baseData,
    },
  });

  await prisma.curriculum.deleteMany({ where: { courseId: course.id } });
  await prisma.curriculum.createMany({
    data: course.curriculums.map((item, index) => ({
      id: `${course.id.slice(0, 24)}${String(index + 1).padStart(12, '0')}`,
      courseId: course.id,
      title: item.title,
      date: item.date,
      time: item.time,
    })),
  });
}

async function upsertPayment(payment) {
  const split = payoutSplit(payment.amount);

  return prisma.payment.upsert({
    where: { id: payment.id },
    update: {
      userId: payment.studentId,
      tutorId: payment.tutorId,
      courseId: payment.courseId,
      amount: payment.amount,
      currency: 'eur',
      status: payment.status,
      type: payment.type,
      payoutStatus: payment.payoutStatus,
      paidAt: payment.paidAt,
      holdUntil: payment.holdUntil,
      paidOutAt: payment.paidOutAt ?? null,
      payoutTransferId: payment.paidOutAt ? `tr_test_${payment.id.slice(0, 8)}` : null,
      payoutFailureReason: null,
      stripeSessionId: payment.stripeSessionId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      ...split,
    },
    create: {
      id: payment.id,
      userId: payment.studentId,
      tutorId: payment.tutorId,
      courseId: payment.courseId,
      amount: payment.amount,
      currency: 'eur',
      status: payment.status,
      type: payment.type,
      payoutStatus: payment.payoutStatus,
      paidAt: payment.paidAt,
      holdUntil: payment.holdUntil,
      paidOutAt: payment.paidOutAt ?? null,
      payoutTransferId: payment.paidOutAt ? `tr_test_${payment.id.slice(0, 8)}` : null,
      payoutFailureReason: null,
      stripeSessionId: payment.stripeSessionId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      ...split,
    },
  });
}

async function main() {
  const now = new Date();

  const tutor = await upsertUser({
    id: TUTOR_ID,
    fullName: 'Tutor Two',
    email: 'tutor2@gmail.com',
    role: Role.TUTOR,
  });

  const student = await upsertUser({
    id: STUDENT_ID,
    fullName: 'Imran Two',
    email: 'imran2@gmail.com',
    role: Role.STUDENT,
  });

  const tutorProfile = await upsertProfile(tutor.id, {
    country: 'Bangladesh',
    city: 'Dhaka',
    avatarUrl:
      'https://res.cloudinary.com/ddypuiex1/image/upload/v1/daanklerk/demo/tutor2-avatar.jpg',
    bio: 'Friendly tutor for route testing.',
    yearOfExperience: 6,
    pricePerHour: 45,
    languageExpertise: 'Bangla, English',
    aboutMe: 'I help students understand programming and mathematics step by step.',
    teachingCategory: 'Programming',
    teachingSkills: ['JavaScript', 'TypeScript', 'Mathematics'],
    sessionDuration: 60,
    videoUrl:
      'https://res.cloudinary.com/ddypuiex1/video/upload/v1/daanklerk/demo/tutor2-intro.mp4',
    applicationStatus: ApplicationStatus.APPROVED,
    averageRating: 4.8,
    totalReviews: 1,
    education: [
      {
        institution: 'Dhaka University',
        country: 'Bangladesh',
        city: 'Dhaka',
        degree: 'BSc in Computer Science',
        passingYear: 2020,
      },
    ],
    availability: [
      {
        dayOfWeek: DayOfWeek.MONDAY,
        startTime: '09:00',
        endTime: '12:00',
        timezone: 'Asia/Dhaka',
      },
      {
        dayOfWeek: DayOfWeek.WEDNESDAY,
        startTime: '18:00',
        endTime: '21:00',
        timezone: 'Asia/Dhaka',
      },
    ],
  });

  await upsertProfile(student.id, {
    country: 'Bangladesh',
    city: 'Dhaka',
    avatarUrl:
      'https://res.cloudinary.com/ddypuiex1/image/upload/v1/daanklerk/demo/imran2-avatar.jpg',
    bio: 'Student account for API testing.',
    applicationStatus: ApplicationStatus.APPROVED,
  });

  await prisma.paymentInformation.upsert({
    where: { userId: tutor.id },
    update: {
      paymentMethod: 'Bank Transfer',
      legalName: tutor.fullName,
      bankName: 'Dutch Bangla Bank',
      bankAccountName: tutor.fullName,
      bankAccountNumber: '1234567890',
      routingNumber: '0901823456',
      stripeAccountId: null,
      payoutsEnabled: false,
      chargesEnabled: false,
      bankLast4: '7890',
      verifiedAt: null,
    },
    create: {
      userId: tutor.id,
      paymentMethod: 'Bank Transfer',
      legalName: tutor.fullName,
      bankName: 'Dutch Bangla Bank',
      bankAccountName: tutor.fullName,
      bankAccountNumber: '1234567890',
      routingNumber: '0901823456',
      stripeAccountId: null,
      payoutsEnabled: false,
      chargesEnabled: false,
      bankLast4: '7890',
      verifiedAt: null,
    },
  });

  const courses = [
    {
      id: CHECKOUT_COURSE_ID,
      tutorId: tutor.id,
      title: 'Checkout Test JavaScript Course',
      category: 'Programming',
      description: 'Use this course to test payment checkout before enrollment.',
      extraInfos: ['Payment required', 'Live class', 'Certificate included'],
      topics: ['Variables', 'Functions', 'Async JavaScript'],
      requirement: 'Laptop and internet connection',
      image:
        'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=450&fit=crop',
      startDate: addDays(now, 15),
      time: '20:00',
      timeZone: 'Asia/Dhaka',
      classDuration: 60,
      language: 'English',
      pricePerStudent: 50,
      minStudent: 1,
      maxStudent: 20,
      enrollmentDeadline: addDays(now, 10),
      curriculums: [
        { title: 'JavaScript Basics', date: addDays(now, 15), time: '20:00' },
        { title: 'DOM Practice', date: addDays(now, 16), time: '20:00' },
        { title: 'Async JavaScript', date: addDays(now, 17), time: '20:00' },
      ],
    },
    {
      id: UPCOMING_COURSE_ID,
      tutorId: tutor.id,
      title: 'Enrolled Upcoming Math Course',
      category: 'Mathematics',
      description: 'Student is already enrolled here for lesson/dashboard testing.',
      extraInfos: ['Already enrolled demo', 'Live class'],
      topics: ['Algebra', 'Geometry', 'Problem Solving'],
      requirement: 'Notebook and calculator',
      image:
        'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&h=450&fit=crop',
      startDate: addDays(now, 3),
      time: '19:00',
      timeZone: 'Asia/Dhaka',
      classDuration: 60,
      language: 'English',
      pricePerStudent: 40,
      minStudent: 1,
      maxStudent: 20,
      enrollmentDeadline: addDays(now, 2),
      curriculums: [
        { title: 'Algebra Foundation', date: addDays(now, 3), time: '19:00' },
        { title: 'Geometry Practice', date: addDays(now, 4), time: '19:00' },
      ],
    },
    {
      id: COMPLETED_COURSE_ID,
      tutorId: tutor.id,
      title: 'Completed Web Development Course',
      category: 'Web Development',
      description: 'Completed course for completed lessons and review testing.',
      extraInfos: ['Completed demo', 'Review ready'],
      topics: ['HTML', 'CSS', 'React'],
      requirement: 'Basic computer knowledge',
      image:
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=450&fit=crop',
      startDate: addDays(now, -10),
      time: '18:00',
      timeZone: 'Asia/Dhaka',
      classDuration: 60,
      language: 'English',
      pricePerStudent: 80,
      minStudent: 1,
      maxStudent: 20,
      enrollmentDeadline: addDays(now, -12),
      curriculums: [
        { title: 'HTML Structure', date: addDays(now, -10), time: '18:00' },
        { title: 'CSS Layout', date: addDays(now, -9), time: '18:00' },
        { title: 'React Components', date: addDays(now, -8), time: '18:00' },
      ],
    },
  ];

  for (const course of courses) {
    await upsertCourse(course);
  }

  for (const courseId of [UPCOMING_COURSE_ID, COMPLETED_COURSE_ID]) {
    await prisma.courseEnrollment.upsert({
      where: {
        courseId_studentId: {
          courseId,
          studentId: student.id,
        },
      },
      update: {},
      create: {
        courseId,
        studentId: student.id,
      },
    });
  }

  for (let index = 0; index < 3; index += 1) {
    await prisma.curriculumProgress.upsert({
      where: {
        courseId_studentId_curriculumIndex: {
          courseId: COMPLETED_COURSE_ID,
          studentId: student.id,
          curriculumIndex: index,
        },
      },
      update: {},
      create: {
        courseId: COMPLETED_COURSE_ID,
        studentId: student.id,
        curriculumIndex: index,
      },
    });
  }

  await prisma.courseCompletion.upsert({
    where: {
      courseId_studentId: {
        courseId: COMPLETED_COURSE_ID,
        studentId: student.id,
      },
    },
    update: {},
    create: {
      courseId: COMPLETED_COURSE_ID,
      studentId: student.id,
    },
  });

  await prisma.resource.upsert({
    where: { id: '82000000-0000-4000-8000-000000000201' },
    update: {
      tutorId: tutor.id,
      courseId: UPCOMING_COURSE_ID,
      name: 'JavaScript Practice PDF',
      url: 'https://res.cloudinary.com/ddypuiex1/raw/upload/v1/daanklerk/demo/javascript-practice.pdf',
      size: '1.2 MB',
    },
    create: {
      id: '82000000-0000-4000-8000-000000000201',
      tutorId: tutor.id,
      courseId: UPCOMING_COURSE_ID,
      name: 'JavaScript Practice PDF',
      url: 'https://res.cloudinary.com/ddypuiex1/raw/upload/v1/daanklerk/demo/javascript-practice.pdf',
      size: '1.2 MB',
    },
  });

  await upsertPayment({
    id: '82000000-0000-4000-8000-000000000301',
    studentId: student.id,
    tutorId: tutor.id,
    courseId: UPCOMING_COURSE_ID,
    amount: 40,
    status: PaymentStatus.PAID,
    type: PaymentType.GROUP,
    payoutStatus: PayoutStatus.ON_HOLD,
    paidAt: addHours(now, -1),
    holdUntil: addHours(now, 47),
    stripeSessionId: 'cs_test_route_upcoming_paid',
    stripePaymentIntentId: 'pi_test_route_upcoming_paid',
  });

  await upsertPayment({
    id: '82000000-0000-4000-8000-000000000302',
    studentId: student.id,
    tutorId: tutor.id,
    courseId: COMPLETED_COURSE_ID,
    amount: 80,
    status: PaymentStatus.PAID,
    type: PaymentType.GROUP,
    payoutStatus: PayoutStatus.PAID,
    paidAt: addDays(now, -9),
    holdUntil: addDays(now, -7),
    paidOutAt: addDays(now, -7),
    stripeSessionId: 'cs_test_route_completed_paid',
    stripePaymentIntentId: 'pi_test_route_completed_paid',
  });

  await prisma.review.upsert({
    where: {
      reviewerId_tutorProfileId: {
        reviewerId: student.id,
        tutorProfileId: tutorProfile.id,
      },
    },
    update: {
      rating: 5,
      comment: 'Great tutor. The lessons were clear and practical.',
    },
    create: {
      reviewerId: student.id,
      tutorProfileId: tutorProfile.id,
      rating: 5,
      comment: 'Great tutor. The lessons were clear and practical.',
    },
  });

  await prisma.contact.upsert({
    where: { id: '82000000-0000-4000-8000-000000000401' },
    update: {
      name: student.fullName,
      email: student.email,
      phone: '+8801700000002',
      subject: 'Payment not completed',
      message: 'I need help testing the support ticket route.',
      status: 'OPEN',
    },
    create: {
      id: '82000000-0000-4000-8000-000000000401',
      name: student.fullName,
      email: student.email,
      phone: '+8801700000002',
      subject: 'Payment not completed',
      message: 'I need help testing the support ticket route.',
      status: 'OPEN',
    },
  });

  await prisma.notification.upsert({
    where: { id: '82000000-0000-4000-8000-000000000501' },
    update: {
      userId: student.id,
      type: 'COURSE_UPDATE',
      title: 'Welcome to your test course',
      body: 'Dummy route test data is ready.',
      data: { courseId: UPCOMING_COURSE_ID },
      targetUrl: `/course/${UPCOMING_COURSE_ID}`,
      isRead: false,
      deliveredAt: now,
    },
    create: {
      id: '82000000-0000-4000-8000-000000000501',
      userId: student.id,
      type: 'COURSE_UPDATE',
      title: 'Welcome to your test course',
      body: 'Dummy route test data is ready.',
      data: { courseId: UPCOMING_COURSE_ID },
      targetUrl: `/course/${UPCOMING_COURSE_ID}`,
      isRead: false,
      deliveredAt: now,
    },
  });

  console.log('Route test dummy data seeded successfully.');
  console.log(`Tutor login: ${tutor.email} / ${PASSWORD}`);
  console.log(`Student login: ${student.email} / ${PASSWORD}`);
  console.log(`Checkout course ID: ${CHECKOUT_COURSE_ID}`);
  console.log(`Upcoming enrolled course ID: ${UPCOMING_COURSE_ID}`);
  console.log(`Completed course ID: ${COMPLETED_COURSE_ID}`);
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
