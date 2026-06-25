import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { TutorReviewListParamDto } from './dto/tutor-review-list-param.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewService } from './review.service';

@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post()
  @UseGuards(AuthGuard)
  create(
    @Req() req: { user: { userId: string } },
    @Body() createReviewDto: CreateReviewDto,
  ) {
    return this.reviewService.create(req.user.userId, createReviewDto);
  }

  @Get()
  findAll(@Query('tutorProfileId') tutorProfileId?: string) {
    return this.reviewService.findAll(tutorProfileId);
  }

  @Get('all')
  findAllReviews(@Query('tutorProfileId') tutorProfileId?: string) {
    return this.reviewService.findAll(tutorProfileId);
  }

  @Get('tutor/:tutorProfileId')
  findTutorReviewList(
    @Param() params: TutorReviewListParamDto,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '5',
  ) {
    return this.reviewService.findTutorReviewList(
      params.tutorProfileId,
      Number(page),
      Number(limit),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reviewService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateReviewDto: UpdateReviewDto) {
    return this.reviewService.update(id, updateReviewDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reviewService.remove(id);
  }
}
