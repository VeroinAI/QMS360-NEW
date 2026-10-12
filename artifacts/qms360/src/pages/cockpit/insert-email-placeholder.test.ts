import { describe, expect, it } from 'vitest';
import { insertEmailPlaceholder } from './insert-email-placeholder';

describe('Email placeholder insertion', () => {
  it('inserts at the blinking cursor rather than the end', () => {
    expect(insertEmailPlaceholder('Dear ,\nRegards', '{recipient_name}', 5)).toEqual({
      value: 'Dear {recipient_name},\nRegards', caret: 21,
    });
  });
  it('inserts at the beginning', () => {
    expect(insertEmailPlaceholder(' approved', '{record_name}', 0)?.value).toBe('{record_name} approved');
  });
  it('replaces selected text without changing the surrounding content', () => {
    expect(insertEmailPlaceholder('Dear Sample Name,\nRegards', '{recipient_name}', 5, 16)?.value)
      .toBe('Dear {recipient_name},\nRegards');
  });
  it('continues from the caret after the previously inserted placeholder', () => {
    const first = insertEmailPlaceholder('Before  after', '{actor_name}', 7)!;
    expect(insertEmailPlaceholder(first.value, '{record_name}', first.caret)?.value)
      .toBe('Before {actor_name}{record_name} after');
  });
  it('appends only when no cursor location has been provided', () => {
    expect(insertEmailPlaceholder('Dear ', '{recipient_name}')?.value).toBe('Dear {recipient_name}');
  });
  it('supports empty text, custom tokens, and subject selections', () => {
    expect(insertEmailPlaceholder('', '{lessons_lesson_form_title}')?.caret).toBe(27);
    expect(insertEmailPlaceholder('Form NAME - submitted', '{lessons_lesson_form_title}', 5, 9)?.value)
      .toBe('Form {lessons_lesson_form_title} - submitted');
  });
  it('preserves line breaks and Unicode around the selection', () => {
    expect(insertEmailPlaceholder('Hi 😀\n\nRegards', '{recipient_name}', 7)?.value)
      .toBe('Hi 😀\n\n{recipient_name}Regards');
  });
  it('respects the field length limit, including replacement of a selection', () => {
    expect(insertEmailPlaceholder('abcde', '{x}', 2, 2, 5)).toBeNull();
    expect(insertEmailPlaceholder('abcde', '{x}', 1, 4, 5)?.value).toBe('a{x}e');
  });
});
