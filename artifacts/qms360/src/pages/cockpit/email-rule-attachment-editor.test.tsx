import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailRuleAttachmentEditor } from './email-rule-attachment-editor';
import { selectedEmailReports } from '@workspace/field-controls';

function render(eventType: string, value: string[] = []) {
  return renderToStaticMarkup(<EmailRuleAttachmentEditor eventType={eventType} value={value} onChange={() => {}} />);
}
describe('Email Rule report attachment selector', () => {
  it('shows only the Lesson Learned PDF for a Lessons event', () => {
    const html = render('lessons.lesson_form.submit', ['lesson_pdf']);
    expect(html).toContain('No attachment');
    expect(html).toContain('Lesson Learned form (PDF)');
    expect(html).not.toContain('Audit Plan');
    expect(html).not.toContain('Completed Audit report');
  });
  it('offers both PDF and PowerPoint for a completed Audit event', () => {
    const html = render('audit.audit.complete', ['audit_report_pdf', 'audit_report_pptx']);
    expect(html).toContain('Completed Audit report (PDF)');
    expect(html).toContain('Completed Audit report (PowerPoint)');
    expect(html).not.toContain('Lesson Learned form');
  });
  it('shows No attachment when the selection is empty', () => {
    expect(render('audit.audit.complete')).toContain('No attachment');
  });
  it('opens legacy single-report rules as a multi-selection and allows clearing them', () => {
    expect(selectedEmailReports({ reportAttachment: 'audit_report_pdf' })).toEqual(['audit_report_pdf']);
    expect(selectedEmailReports({ reportAttachment: 'audit_report_pdf', reportAttachments: [] })).toEqual([]);
    expect(selectedEmailReports({ reportAttachments: ['audit_report_pdf', 'audit_report_pptx'] })).toEqual(['audit_report_pdf', 'audit_report_pptx']);
  });
  it('does not offer reports from other modules or unsupported events', () => {
    const html = render('qaqc.workspace_role.update');
    expect(html).toContain('no standalone PDF or PowerPoint report');
    expect(html).not.toContain('value="lesson_pdf"');
    expect(html).not.toContain('value="audit_report_pptx"');
  });
});
