import { server } from '@aha-app/builder-core';

export function renderDiscussionNotification(data: {
  migrationName: string;
  stakeholderName: string;
  question: string;
  recordContext: string;
  discussionId: number;
  appUrl: string;
}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
          <tr>
            <td style="background-color: #5c1a1a; padding: 24px 32px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: rgba(255,255,255,0.7); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">MergeFlow</p>
                    <h1 style="margin: 0; font-family: Arial, sans-serif; font-size: 20px; color: #ffffff; font-weight: 700;">Clarification Requested</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="font-family: Arial, sans-serif; font-size: 15px; color: #111827; margin: 0 0 8px;">Hi ${data.stakeholderName},</p>
              <p style="font-family: Arial, sans-serif; font-size: 14px; color: #6b7280; margin: 0 0 24px;">
                You have been identified as the responsible stakeholder for a migration clarification in <strong style="color: #111827;">${data.migrationName}</strong>.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; background-color: #fef9f0; border: 1px solid #d97706; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="font-family: Arial, sans-serif; font-size: 11px; color: #b45309; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 700;">Question requiring clarification</p>
                    <p style="font-family: Arial, sans-serif; font-size: 15px; color: #111827; margin: 0; font-style: italic;">"${data.question}"</p>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="font-family: Arial, sans-serif; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 700;">Record context</p>
                    <p style="font-family: Arial, sans-serif; font-size: 13px; color: #374151; margin: 0; font-family: 'Courier New', monospace;">${data.recordContext}</p>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #5c1a1a; border-radius: 6px; padding: 12px 24px;">
                    <a href="${data.appUrl}" style="font-family: Arial, sans-serif; font-size: 14px; color: #ffffff; text-decoration: none; font-weight: bold;">View Discussion →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; margin: 0;">
                You received this because you are a listed stakeholder on the <strong>${data.migrationName}</strong> migration project. Please log in to MergeFlow to respond.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Email template registration
// Note: emailTemplate may not be in all type def versions but works at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(server as any).emailTemplate?.('discussionNotification', {
  name: 'Discussion Notification',
  subject: 'Clarification requested on migration record',
  preview: () => ({
    to: 'stakeholder@example.com',
    data: {
      migrationName: 'BetaSoft to Salesforce',
      stakeholderName: 'Alex Johnson',
      question: 'Can the BetaSoft team provide the current email address for this customer, or confirm that no valid email is available?',
      recordContext: 'Customer: Acme Corp | Row #42 | Source: BetaSoft CRM',
      discussionId: 1,
      appUrl: 'https://app.example.com/projects/1/review',
    },
  }),
  render: renderDiscussionNotification,
});