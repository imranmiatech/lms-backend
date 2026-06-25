import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ADMIN_STUDENT_STATUS_FILTERS = [
  'all',
  'active',
  'inactive',
] as const;

export type AdminStudentStatusFilter =
  (typeof ADMIN_STUDENT_STATUS_FILTERS)[number];

export class AdminStudentManagementQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(ADMIN_STUDENT_STATUS_FILTERS)
  status?: AdminStudentStatusFilter = 'all';
}
