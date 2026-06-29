import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  MinLength,
} from "class-validator";

import { Role } from "@prisma/client";

export class RegisterDto {
  /**
   * The full name of the user.
   * @example "John Doe"
   */
  @IsNotEmpty()
  fullName!: string;

  /**
   * The email address of the user.
   * @example "john.doe@example.com"
   */
  @IsEmail()
  email!: string;

  /**
   * The password for the user account (minimum 6 characters).
   * @example "securePassword123"
   */
  @MinLength(6)
  password!: string;

  /**
   * The role of the user (e.g. STUDENT, TUTOR, ADMIN).
   * @example "STUDENT"
   */
  @IsEnum(Role)
  role!: Role;
}

export class UserProfileResponseDto {
  /**
   * The unique identifier of the profile.
   * @example "a87e387c-3b91-4d1a-82dc-304bfa4d89a7"
   */
  id!: string;

  /**
   * The ID of the associated user.
   * @example "5f5b9d3b-6e9f-4b08-8df0-1014a4c62f2d"
   */
  userId!: string;

  /**
   * Country of the user.
   * @example "United States"
   */
  country!: string | null;

  /**
   * City of the user.
   * @example "New York"
   */
  city!: string | null;

  /**
   * Avatar URL of the user.
   * @example "https://example.com/avatars/johndoe.png"
   */
  avatarUrl!: string | null;

  /**
   * Short bio of the user.
   * @example "Math tutor with 5 years of experience."
   */
  bio!: string | null;

  /**
   * Years of experience.
   * @example 5
   */
  yearOfExperience!: number | null;

  /**
   * Price per hour in EUR.
   * @example 25.0
   */
  pricePerHour!: number | null;

  /**
   * Spoken languages.
   * @example "English, Spanish"
   */
  languageExpertise!: string | null;

  /**
   * Rich text describing the tutor/student.
   * @example "I specialize in calculus and algebra..."
   */
  aboutMe!: string | null;

  /**
   * Main teaching subject/category.
   * @example "Mathematics"
   */
  teachingCategory!: string | null;

  /**
   * Specific teaching skills/styles.
   * @example ["Warm & friendly", "Strict & structured"]
   */
  teachingSkills!: string[];

  /**
   * Default session duration in minutes.
   * @example 60
   */
  sessionDuration!: number | null;

  /**
   * Introductory video URL.
   * @example "https://youtube.com/watch?v=intro"
   */
  videoUrl!: string | null;

  /**
   * Registration/application status.
   * @example "DRAFT"
   */
  applicationStatus!: string;

  /**
   * Profile creation timestamp.
   * @example "2026-06-05T01:48:33.000Z"
   */
  createdAt!: Date;

  /**
   * Profile last updated timestamp.
   * @example "2026-06-05T01:48:33.000Z"
   */
  updatedAt!: Date;
}

export class UserResponseDto {
  /**
   * The unique identifier of the user.
   * @example "5f5b9d3b-6e9f-4b08-8df0-1014a4c62f2d"
   */
  id!: string;

  /**
   * The email address of the user.
   * @example "john.doe@example.com"
   */
  email!: string;

  /**
   * The full name of the user.
   * @example "John Doe"
   */
  fullName!: string;

  /**
   * The role of the user.
   * @example "STUDENT"
   */
  role!: Role;

  /**
   * Indicates whether the user's email has been verified.
   * @example false
   */
  isEmailVerified!: boolean;

  /**
   * User creation timestamp.
   * @example "2026-06-05T01:48:33.000Z"
   */
  createdAt!: Date;

  /**
   * User last updated timestamp.
   * @example "2026-06-05T01:48:33.000Z"
   */
  updatedAt!: Date;

  /**
   * The associated user profile.
   */
  profile!: UserProfileResponseDto;
}

export class RegisterResponseDto {
  /**
   * Indicates if the operation was successful.
   * @example true
   */
  success!: boolean;

  /**
   * Success message.
   * @example "Registration successful"
   */
  message!: string;

  /**
   * User details.
   */
  data!: UserResponseDto;
}

export class LoginDto {
  /**
   * The email address of the user.
   * @example "john.doe@example.com"
   */
  @IsEmail()
  email!: string;

  /**
   * The password for the user account.
   * @example "securePassword123"
   */
  @MinLength(6)
  password!: string;
}

export class LoginResponseDto {
  /**
   * Indicates if the login operation was successful.
   * @example true
   */
  success!: boolean;

  /**
   * Success message.
   * @example "Login successful"
   */
  message!: string;

  /**
   * JWT Access Token.
   * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   */
  accessToken!: string;

  /**
   * JWT Refresh Token.
   * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   */
  refreshToken!: string;

  /**
   * User details.
   */
  user!: UserResponseDto;
}

export class ForgotPasswordDto {
  /**
   * The email address of the user who forgot their password.
   * @example "john.doe@example.com"
   */
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  /**
   * The email address of the user.
   * @example "john.doe@example.com"
   */
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  /**
   * The 6-digit OTP code received in email.
   * @example "123456"
   */
  @IsNotEmpty()
  @MinLength(6)
  otp!: string;

  /**
   * The new secure password (minimum 6 characters).
   * @example "newSecurePassword123"
   */
  @IsNotEmpty()
  @MinLength(6)
  newPassword!: string;
}

export class ForgotPasswordResponseDto {
  /**
   * Indicates if the password reset request was successful.
   * @example true
   */
  success!: boolean;

  /**
   * Status message.
   * @example "Password reset OTP sent to your email"
   */
  message!: string;
}

export class ResetPasswordResponseDto {
  /**
   * Indicates if the password reset was successful.
   * @example true
   */
  success!: boolean;

  /**
   * Status message.
   * @example "Password reset successful"
   */
  message!: string;
}
