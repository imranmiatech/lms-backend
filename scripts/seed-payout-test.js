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
const commissionRate = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.2);

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function payoutSplit(amount) {
  const commissionAmount = Number((amount * commissionRate).toFixed(2));
  const tutorAmount = Number((amount - commissionAmount).toFixed(2));

  return {
    commissionRate,
    commissionAmount,
    tutorAmount,
  };
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

async function upsertPayment({
  id,
  studentId,
  tutorId,
  amount,
  payoutStatus,
  paidAt,
  holdUntil,
  paidOutAt = null,
  failureReason = null,
}) {
  const split = payoutSplit(amount);

  return prisma.payment.upsert({
    where: { id },
    update: {
      userId: studentId,
      tutorId,
      courseId: null,
      amount,
      currency: 'eur',
      status: PaymentStatus.PAID,
      type: PaymentType.PRIVATE,
      payoutStatus,
      paidAt,
      holdUntil,
      paidOutAt,
      payoutTransferId: paidOutAt ? `tr_test_${id.slice(0, 8)}` : null,
      payoutFailureReason: failureReason,
      stripePaymentIntentId: `pi_test_${id.slice(0, 8)}`,
      ...split,
      createdAt: paidAt,
    },
    create: {
      id,
      userId: studentId,
      tutorId,
      courseId: null,
      amount,
      currency: 'eur',
      status: PaymentStatus.PAID,
      type: PaymentType.PRIVATE,
      payoutStatus,
      paidAt,
      holdUntil,
      paidOutAt,
      payoutTransferId: paidOutAt ? `tr_test_${id.slice(0, 8)}` : null,
      payoutFailureReason: failureReason,
      stripePaymentIntentId: `pi_test_${id.slice(0, 8)}`,
      ...split,
      createdAt: paidAt,
    },
  });
}

async function main() {
  const tutor = await upsertUser({
    id: '71000000-0000-4000-8000-000000000001',
    fullName: 'Payout Test Tutor',
    email: 'payout.tutor@daan.test',
    role: Role.TUTOR,
    profile: {
      bio: 'Tutor account for payout testing.',
      yearOfExperience: 4,
      pricePerHour: 100,
      teachingCategory: 'Mathematics',
      teachingSkills: ['Payout Test', 'Private Session'],
      sessionDuration: 60,
      applicationStatus: ApplicationStatus.APPROVED,
      averageRating: 4.8,
      totalReviews: 12,
    },
  });

  const student = await upsertUser({
    id: '72000000-0000-4000-8000-000000000001',
    fullName: 'Payout Test Student',
    email: 'payout.student@daan.test',
    role: Role.STUDENT,
    profile: {
      avatarUrl: null,
      applicationStatus: ApplicationStatus.APPROVED,
    },
  });

  await prisma.paymentInformation.upsert({
    where: { userId: tutor.id },
    update: {
      paymentMethod: 'Bank Transfer',
      legalName: tutor.fullName,
      bankName: 'Test Bank',
      bankAccountName: tutor.fullName,
      bankAccountNumber: '000111222333',
      routingNumber: '0901823456',
      stripeAccountId: null,
      payoutsEnabled: false,
      chargesEnabled: false,
      bankLast4: '2333',
      verifiedAt: null,
    },
    create: {
      userId: tutor.id,
      paymentMethod: 'Bank Transfer',
      legalName: tutor.fullName,
      bankName: 'Test Bank',
      bankAccountName: tutor.fullName,
      bankAccountNumber: '000111222333',
      routingNumber: '0901823456',
      stripeAccountId: null,
      payoutsEnabled: false,
      chargesEnabled: false,
      bankLast4: '2333',
      verifiedAt: null,
    },
  });

  await upsertPayment({
    id: '73000000-0000-4000-8000-000000000001',
    studentId: student.id,
    tutorId: tutor.id,
    amount: 100,
    payoutStatus: PayoutStatus.ON_HOLD,
    paidAt: hoursAgo(1),
    holdUntil: hoursFromNow(47),
  });

  await upsertPayment({
    id: '73000000-0000-4000-8000-000000000002',
    studentId: student.id,
    tutorId: tutor.id,
    amount: 150,
    payoutStatus: PayoutStatus.ON_HOLD,
    paidAt: hoursAgo(50),
    holdUntil: hoursAgo(2),
  });

  await upsertPayment({
    id: '73000000-0000-4000-8000-000000000003',
    studentId: student.id,
    tutorId: tutor.id,
    amount: 200,
    payoutStatus: PayoutStatus.PAID,
    paidAt: hoursAgo(80),
    holdUntil: hoursAgo(32),
    paidOutAt: hoursAgo(30),
  });

  await upsertPayment({
    id: '73000000-0000-4000-8000-000000000004',
    studentId: student.id,
    tutorId: tutor.id,
    amount: 120,
    payoutStatus: PayoutStatus.FAILED,
    paidAt: hoursAgo(72),
    holdUntil: hoursAgo(24),
    failureReason: 'Dummy failed payout for admin table testing',
  });

  console.log('Payout test data seeded successfully.');
  console.log('Tutor login:', tutor.email, '/', password);
  console.log('Student login:', student.email, '/', password);
  console.log('Due payment id:', '73000000-0000-4000-8000-000000000002');
  console.log(
    'Note: due payment will fail payout until tutor completes Stripe Connect.',
  );
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
