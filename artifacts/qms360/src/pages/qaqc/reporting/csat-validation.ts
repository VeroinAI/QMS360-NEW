import { CSAT_QUESTIONS, OUTCOMES, type Obj } from './reporting-types';

export function validateCsat(data: Obj): string[] {
  return [
    ...CSAT_QUESTIONS.filter(([key]) => {
      const value = Number(data.ratings?.[key]);
      return !Number.isInteger(value) || value < 1 || value > 5;
    }).map(([, label]) => `${label}: select a rating from 1 to 5.`),
    ...([
      ['expectations', 'Project Completed as per Expectations'],
      ['recommend', 'Would Recommend Our Services'],
    ] as const).filter(([key]) => !OUTCOMES.includes(data[key])).map(([, label]) => `${label}: select Yes, No or Partially.`),
  ];
}