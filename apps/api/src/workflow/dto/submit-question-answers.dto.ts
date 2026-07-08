import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  questionAnswerSchema,
  submitQuestionAnswersSchema,
  type QuestionAnswerRequest,
  type SubmitQuestionAnswersRequest,
} from '@nexus/core';

export class QuestionAnswerDto {
  static readonly schema = questionAnswerSchema;

  @ApiProperty({ description: 'Zero-based index of the question' })
  questionIndex: QuestionAnswerRequest['questionIndex'];

  @ApiPropertyOptional({
    description: 'The option the user selected (null if free-text only)',
  })
  selectedOption: QuestionAnswerRequest['selectedOption'];

  @ApiPropertyOptional({
    description: 'Free-text answer from the user (null if option-only)',
  })
  freeTextAnswer: QuestionAnswerRequest['freeTextAnswer'];
}

export class SubmitQuestionAnswersDto {
  static readonly schema = submitQuestionAnswersSchema;

  @ApiProperty({
    description: 'Answers to the questions posed by the agent',
    type: [QuestionAnswerDto],
  })
  answers: SubmitQuestionAnswersRequest['answers'];
}
