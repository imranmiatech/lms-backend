require('dotenv/config');

const bcrypt = require('bcrypt');
const {
  ApplicationStatus,
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

const password = 'password123';

function utcDate(value) {
  return new Date(value);
}

async function upsertUser({ id, fullName, email, role, profile }) {
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      password: passwordHash,
      role,
      isEmailVerified: true,
    },
    create: {
      id,
      fullName,
      email,
      password: passwordHash,
      role,
      isEmailVerified: true,
    },
  });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: profile,
    create: {
      userId: user.id,
      ...profile,
    },
  });

  return user;
}

async function main() {
  const admin = await upsertUser({
    id: '10000000-0000-4000-8000-000000000001',
    fullName: 'Admin User',
    email: 'admin@daan.test',
    role: Role.ADMIN,
    profile: {
      avatarUrl: null,
      applicationStatus: ApplicationStatus.APPROVED,
    },
  });

  const tutorSeeds = [
    ['Albert Flores', 'albert.flores@daan.test', 'Mathematics', 94],
    ['Jacob Jones', 'jacob.jones.tutor@daan.test', 'English Literature', 40],
    ['Floyd Miles', 'floyd.miles@daan.test', 'Computer Science', 120],
    ['Robert Fox', 'robert.fox.tutor@daan.test', 'Physics', 105],
    ['Darlene Robertson', 'darlene.robertson@daan.test', 'Mathematics', 250],
    ['Leslie Alexander', 'leslie.alexander@daan.test', 'English', 320],
    ['Savannah Nguyen', 'savannah.nguyen.tutor@daan.test', 'Physics', 40],
  ];

  const studentSeeds = [
    ['Jacob Jones', 'jacob.jones.student@daan.test'],
    ['Robert Fox', 'robert.fox.student@daan.test'],
    ['Savannah Nguyen', 'savannah.nguyen.student@daan.test'],
    ['Floyd Miles', 'floyd.miles.student@daan.test'],
    ['Leslie Alexander', 'leslie.alexander.student@daan.test'],
    ['Darlene Robertson', 'darlene.robertson.student@daan.test'],
    ['Albert Flores', 'albert.flores.student@daan.test'],
  ];

  const tutors = [];
  for (let index = 0; index < tutorSeeds.length; index += 1) {
    const [fullName, email, category, pricePerHour] = tutorSeeds[index];
    tutors.push(
      await upsertUser({
        id: `20000000-0000-4000-8000-00000000000${index + 1}`,
        fullName,
        email,
        role: Role.TUTOR,
        profile: {
          bio: `${fullName} is an experienced ${category} tutor.`,
          yearOfExperience: 5 + index,
          pricePerHour,
          teachingCategory: category,
          teachingSkills: [category, 'Live Class', 'Private Session'],
          sessionDuration: 60,
          applicationStatus: ApplicationStatus.APPROVED,
          averageRating: 4.6 + index * 0.05,
          totalReviews: 10 + index,
        },
      }),
    );
  }

  const students = [];
  for (let index = 0; index < studentSeeds.length; index += 1) {
    const [fullName, email] = studentSeeds[index];
    students.push(
      await upsertUser({
        id: `30000000-0000-4000-8000-00000000000${index + 1}`,
        fullName,
        email,
        role: Role.STUDENT,
        profile: {
          avatarUrl: null,
          applicationStatus: ApplicationStatus.APPROVED,
        },
      }),
    );
  }

  const courseSeeds = [
    {
      id: '40000000-0000-4000-8000-000000000001',
      title: 'Advanced Mathematics',
      category: 'Mathematics',
      tutor: tutors[0],
      pricePerStudent: 94,
      startDate: utcDate('2026-05-20T00:00:00.000Z'),
      time: '10:41',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      title: 'English Literature',
      category: 'English',
      tutor: tutors[1],
      pricePerStudent: 40,
      startDate: utcDate('2026-06-01T00:00:00.000Z'),
      time: '05:49',
    },
    {
      id: '40000000-0000-4000-8000-000000000003',
      title: 'Computer Science Basics',
      category: 'Computer Science',
      tutor: tutors[2],
      pricePerStudent: 120,
      startDate: utcDate('2026-01-19T00:00:00.000Z'),
      time: '11:23',
    },
    {
      id: '40000000-0000-4000-8000-000000000004',
      title: 'Physics Fundamentals',
      category: 'Physics',
      tutor: tutors[3],
      pricePerStudent: 105,
      startDate: utcDate('2026-01-19T00:00:00.000Z'),
      time: '06:41',
    },
  ];

  for (const course of courseSeeds) {
    await prisma.course.upsert({
      where: { id: course.id },
      update: {
        tutorId: course.tutor.id,
        title: course.title,
        category: course.category,
        description: `${course.title} group live class for enrolled students.`,
        extraInfos: ['Live class', 'Group session', 'Certificate included'],
        topics: ['Introduction', 'Core Concepts', 'Practice', 'Review'],
        requirement: 'Internet connection and notebook',
        image: null,
        curriculums: ['Introduction', 'Core Concepts', 'Practice', 'Review'],
        startDate: course.startDate,
        time: course.time,
        timeZone: 'Asia/Dhaka',
        classDuration: 60,
        language: 'English',
        courseDuration: 4,
        pricePerStudent: course.pricePerStudent,
        minStudent: 1,
        maxStudent: 20,
        enrollmentDeadline: utcDate('2026-12-31T23:59:59.000Z'),
      },
      create: {
        id: course.id,
        tutorId: course.tutor.id,
        title: course.title,
        category: course.category,
        description: `${course.title} group live class for enrolled students.`,
        extraInfos: ['Live class', 'Group session', 'Certificate included'],
        topics: ['Introduction', 'Core Concepts', 'Practice', 'Review'],
        requirement: 'Internet connection and notebook',
        image: null,
        curriculums: ['Introduction', 'Core Concepts', 'Practice', 'Review'],
        startDate: course.startDate,
        time: course.time,
        timeZone: 'Asia/Dhaka',
        classDuration: 60,
        language: 'English',
        courseDuration: 4,
        pricePerStudent: course.pricePerStudent,
        minStudent: 1,
        maxStudent: 20,
        enrollmentDeadline: utcDate('2026-12-31T23:59:59.000Z'),
      },
    });
  }

  const visiblePayments = [
    [tutors[0], students[0], null, 94, PaymentType.PRIVATE, PaymentStatus.PAID, PayoutStatus.PENDING, '2026-05-20T10:41:00.000Z'],
    [tutors[1], students[1], null, 40, PaymentType.PRIVATE, PaymentStatus.PAID, PayoutStatus.PENDING, '2026-06-01T05:49:00.000Z'],
    [tutors[2], students[2], courseSeeds[2], 120, PaymentType.GROUP, PaymentStatus.PAID, PayoutStatus.PAID, '2026-01-19T11:23:00.000Z'],
    [tutors[3], students[3], null, 105, PaymentType.PRIVATE, PaymentStatus.PAID, PayoutStatus.PENDING, '2026-01-19T06:41:00.000Z'],
    [tutors[4], students[4], courseSeeds[0], 250, PaymentType.GROUP, PaymentStatus.PAID, PayoutStatus.PAID, '2026-01-24T07:40:00.000Z'],
    [tutors[5], students[5], courseSeeds[1], 320, PaymentType.GROUP, PaymentStatus.PAID, PayoutStatus.PAID, '2026-01-24T11:49:00.000Z'],
    [tutors[6], students[6], null, 40, PaymentType.PRIVATE, PaymentStatus.PAID, PayoutStatus.PENDING, '2026-01-19T05:51:00.000Z'],
  ];

  const payments = [...visiblePayments];
  const paidSoFar = visiblePayments.reduce((sum, payment) => sum + payment[3], 0);
  const targetPaidTotal = 328500;
  const targetCompletedPayouts = 262800;
  const paidTopUp = targetPaidTotal - paidSoFar;
  const paidPayoutSoFar = visiblePayments
    .filter((payment) => payment[6] === PayoutStatus.PAID)
    .reduce((sum, payment) => sum + payment[3], 0);
  const completedPayoutTopUp = targetCompletedPayouts - paidPayoutSoFar;

  payments.push([
    tutors[0],
    students[1],
    courseSeeds[0],
    completedPayoutTopUp,
    PaymentType.GROUP,
    PaymentStatus.PAID,
    PayoutStatus.PAID,
    '2026-06-10T09:30:00.000Z',
  ]);

  payments.push([
    tutors[1],
    students[2],
    null,
    paidTopUp - completedPayoutTopUp,
    PaymentType.PRIVATE,
    PaymentStatus.PAID,
    PayoutStatus.PENDING,
    '2026-06-11T09:30:00.000Z',
  ]);

  payments.push([
    tutors[2],
    students[3],
    courseSeeds[2],
    8450,
    PaymentType.GROUP,
    PaymentStatus.PENDING,
    PayoutStatus.PENDING,
    '2026-06-12T09:30:00.000Z',
  ]);

  for (let index = 0; index < payments.length; index += 1) {
    const [tutor, student, course, amount, type, status, payoutStatus, date] =
      payments[index];
    const id = `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

    await prisma.payment.upsert({
      where: { id },
      update: {
        userId: student.id,
        tutorId: tutor.id,
        courseId: course?.id ?? null,
        amount,
        currency: 'eur',
        status,
        type,
        payoutStatus,
        createdAt: utcDate(date),
      },
      create: {
        id,
        userId: student.id,
        tutorId: tutor.id,
        courseId: course?.id ?? null,
        amount,
        currency: 'eur',
        status,
        type,
        payoutStatus,
        createdAt: utcDate(date),
      },
    });

    if (type === PaymentType.GROUP && status === PaymentStatus.PAID && course) {
      await prisma.courseEnrollment.upsert({
        where: {
          courseId_studentId: {
            courseId: course.id,
            studentId: student.id,
          },
        },
        update: {},
        create: {
          courseId: course.id,
          studentId: student.id,
        },
      });
    }
  }

  console.log('Admin dashboard dummy data seeded successfully.');
  console.log('Admin login:', admin.email, '/', password);
  console.log('Tutor/student demo password:', password);
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
