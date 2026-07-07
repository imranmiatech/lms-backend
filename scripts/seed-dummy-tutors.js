require('dotenv/config');

const bcrypt = require('bcrypt');
const {
  ApplicationStatus,
  DayOfWeek,
  PrismaClient,
  Role,
} = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = 'password123';

const tutorSeeds = [
  {
    id: '91000000-0000-4000-8000-000000000001',
    fullName: 'Ava Thompson',
    email: 'ava.thompson@daan.test',
    country: 'United States',
    city: 'Austin',
    avatarUrl:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&h=240&fit=crop',
    bio: 'Mathematics tutor focused on confidence-building and exam preparation.',
    yearOfExperience: 7,
    pricePerHour: 55,
    languageExpertise: 'English, Spanish',
    aboutMe:
      'I break down difficult algebra and calculus ideas into small, practical steps.',
    teachingCategory: 'Mathematics',
    teachingSkills: ['Algebra', 'Calculus', 'SAT Math'],
    sessionDuration: 60,
    averageRating: 4.9,
    totalReviews: 28,
    education: [
      {
        institution: 'University of Texas',
        country: 'United States',
        city: 'Austin',
        degree: 'BSc in Mathematics',
        passingYear: 2019,
      },
    ],
    availability: [
      { dayOfWeek: DayOfWeek.MONDAY, startTime: '09:00', endTime: '12:00' },
      { dayOfWeek: DayOfWeek.WEDNESDAY, startTime: '15:00', endTime: '18:00' },
    ],
  },
  {
    id: '91000000-0000-4000-8000-000000000002',
    fullName: 'Noah Martinez',
    email: 'noah.martinez@daan.test',
    country: 'Canada',
    city: 'Toronto',
    avatarUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&fit=crop',
    bio: 'Programming mentor for web development and backend fundamentals.',
    yearOfExperience: 6,
    pricePerHour: 65,
    languageExpertise: 'English',
    aboutMe:
      'I help students build strong JavaScript and Node.js foundations with real projects.',
    teachingCategory: 'Programming',
    teachingSkills: ['JavaScript', 'Node.js', 'TypeScript'],
    sessionDuration: 60,
    averageRating: 4.8,
    totalReviews: 19,
    education: [
      {
        institution: 'University of Toronto',
        country: 'Canada',
        city: 'Toronto',
        degree: 'BSc in Computer Science',
        passingYear: 2020,
      },
    ],
    availability: [
      { dayOfWeek: DayOfWeek.TUESDAY, startTime: '10:00', endTime: '13:00' },
      { dayOfWeek: DayOfWeek.THURSDAY, startTime: '17:00', endTime: '20:00' },
    ],
  },
  {
    id: '91000000-0000-4000-8000-000000000003',
    fullName: 'Emma Rahman',
    email: 'emma.rahman@daan.test',
    country: 'Bangladesh',
    city: 'Dhaka',
    avatarUrl:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=240&h=240&fit=crop',
    bio: 'English communication coach for speaking, writing, and interview prep.',
    yearOfExperience: 8,
    pricePerHour: 48,
    languageExpertise: 'English, Bangla',
    aboutMe:
      'My sessions are practical and interactive, especially for spoken English improvement.',
    teachingCategory: 'English',
    teachingSkills: ['Speaking', 'Writing', 'IELTS'],
    sessionDuration: 45,
    averageRating: 4.7,
    totalReviews: 34,
    education: [
      {
        institution: 'BRAC University',
        country: 'Bangladesh',
        city: 'Dhaka',
        degree: 'BA in English',
        passingYear: 2018,
      },
    ],
    availability: [
      { dayOfWeek: DayOfWeek.SATURDAY, startTime: '10:00', endTime: '14:00' },
      { dayOfWeek: DayOfWeek.SUNDAY, startTime: '18:00', endTime: '21:00' },
    ],
  },
  {
    id: '91000000-0000-4000-8000-000000000004',
    fullName: 'Liam Chen',
    email: 'liam.chen@daan.test',
    country: 'Singapore',
    city: 'Singapore',
    avatarUrl:
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=240&h=240&fit=crop',
    bio: 'Physics tutor who blends concept clarity with problem-solving drills.',
    yearOfExperience: 9,
    pricePerHour: 72,
    languageExpertise: 'English, Mandarin',
    aboutMe:
      'I teach mechanics and electricity with visual examples and exam-style practice.',
    teachingCategory: 'Physics',
    teachingSkills: ['Mechanics', 'Electricity', 'A-Level Physics'],
    sessionDuration: 60,
    averageRating: 4.9,
    totalReviews: 22,
    education: [
      {
        institution: 'National University of Singapore',
        country: 'Singapore',
        city: 'Singapore',
        degree: 'BSc in Physics',
        passingYear: 2017,
      },
    ],
    availability: [
      { dayOfWeek: DayOfWeek.MONDAY, startTime: '18:00', endTime: '21:00' },
      { dayOfWeek: DayOfWeek.FRIDAY, startTime: '09:00', endTime: '12:00' },
    ],
  },
  {
    id: '91000000-0000-4000-8000-000000000005',
    fullName: 'Sophia Khan',
    email: 'sophia.khan@daan.test',
    country: 'United Kingdom',
    city: 'London',
    avatarUrl:
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=240&h=240&fit=crop',
    bio: 'Creative design instructor covering UI basics, Figma, and portfolio projects.',
    yearOfExperience: 5,
    pricePerHour: 58,
    languageExpertise: 'English',
    aboutMe:
      'I guide students from design fundamentals to polished case studies and portfolio reviews.',
    teachingCategory: 'Design',
    teachingSkills: ['Figma', 'UI Design', 'Portfolio Review'],
    sessionDuration: 60,
    averageRating: 4.6,
    totalReviews: 16,
    education: [
      {
        institution: 'University of the Arts London',
        country: 'United Kingdom',
        city: 'London',
        degree: 'BA in Design',
        passingYear: 2021,
      },
    ],
    availability: [
      { dayOfWeek: DayOfWeek.WEDNESDAY, startTime: '11:00', endTime: '15:00' },
      { dayOfWeek: DayOfWeek.SATURDAY, startTime: '16:00', endTime: '19:00' },
    ],
  },
];

async function upsertTutor(seed) {
  const password = await bcrypt.hash(PASSWORD, 10);

  const tutor = await prisma.user.upsert({
    where: { email: seed.email },
    update: {
      fullName: seed.fullName,
      password,
      role: Role.TUTOR,
      isEmailVerified: true,
    },
    create: {
      id: seed.id,
      fullName: seed.fullName,
      email: seed.email,
      password,
      role: Role.TUTOR,
      isEmailVerified: true,
    },
  });

  const profile = await prisma.userProfile.upsert({
    where: { userId: tutor.id },
    update: {
      country: seed.country,
      city: seed.city,
      avatarUrl: seed.avatarUrl,
      bio: seed.bio,
      yearOfExperience: seed.yearOfExperience,
      pricePerHour: seed.pricePerHour,
      languageExpertise: seed.languageExpertise,
      aboutMe: seed.aboutMe,
      teachingCategory: seed.teachingCategory,
      teachingSkills: seed.teachingSkills,
      sessionDuration: seed.sessionDuration,
      applicationStatus: ApplicationStatus.APPROVED,
      averageRating: seed.averageRating,
      totalReviews: seed.totalReviews,
    },
    create: {
      userId: tutor.id,
      country: seed.country,
      city: seed.city,
      avatarUrl: seed.avatarUrl,
      bio: seed.bio,
      yearOfExperience: seed.yearOfExperience,
      pricePerHour: seed.pricePerHour,
      languageExpertise: seed.languageExpertise,
      aboutMe: seed.aboutMe,
      teachingCategory: seed.teachingCategory,
      teachingSkills: seed.teachingSkills,
      sessionDuration: seed.sessionDuration,
      applicationStatus: ApplicationStatus.APPROVED,
      averageRating: seed.averageRating,
      totalReviews: seed.totalReviews,
    },
  });

  await prisma.education.deleteMany({ where: { profileId: profile.id } });
  await prisma.availability.deleteMany({ where: { profileId: profile.id } });

  await prisma.education.createMany({
    data: seed.education.map((item) => ({
      profileId: profile.id,
      ...item,
    })),
  });

  await prisma.availability.createMany({
    data: seed.availability.map((item) => ({
      profileId: profile.id,
      ...item,
    })),
  });
}

async function main() {
  for (const tutorSeed of tutorSeeds) {
    await upsertTutor(tutorSeed);
  }

  console.log(`Dummy tutors seeded successfully: ${tutorSeeds.length}`);
}

main()
  .catch((error) => {
    console.error('Failed to seed dummy tutors', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
