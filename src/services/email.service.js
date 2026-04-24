const nodemailer = require('nodemailer');
const logger = require('../config/logger');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'CrackDetectX <noreply@crackdetectx.com>',
      to,
      subject,
      html,
      text,
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Email send failed to ${to}: ${err.message}`);
    throw err;
  }
};

const sendVerificationEmail = (to, name, token) =>
  sendEmail({
    to,
    subject: 'Verify your CrackDetectX account',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#2563eb;">Welcome to CrackDetectX, ${name}!</h2>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="${process.env.FRONTEND_URL}/verify-email?token=${token}"
           style="background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin:16px 0;">
          Verify Email
        </a>
        <p style="color:#666;font-size:13px;">This link expires in 24 hours.</p>
      </div>
    `,
  });

const sendPasswordResetEmail = (to, name, token) =>
  sendEmail({
    to,
    subject: 'Reset your CrackDetectX password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#dc2626;">Password Reset Request</h2>
        <p>Hi ${name}, we received a request to reset your password.</p>
        <a href="${process.env.FRONTEND_URL}/reset-password?token=${token}"
           style="background:#dc2626;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin:16px 0;">
          Reset Password
        </a>
        <p style="color:#666;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });

const sendScanCompleteEmail = (to, name, scanId, reportUrl) =>
  sendEmail({
    to,
    subject: 'Your CrackDetectX scan is complete',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#059669;">Scan Analysis Complete ✓</h2>
        <p>Hi ${name}, your crack detection analysis has finished.</p>
        <a href="${process.env.FRONTEND_URL}/scans/${scanId}"
           style="background:#059669;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin:16px 0;">
          View Results
        </a>
      </div>
    `,
  });

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail, sendScanCompleteEmail };