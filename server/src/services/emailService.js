const failedLoginNotices = new Map();
const failedLoginNoticeDelay = 15 * 60 * 1000;

async function makeTransporter() {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    return null;
  }

  const mailLibrary = await import("nodemailer");
  const nodemailer = mailLibrary.default || mailLibrary;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendNotice(
  user,
  subject,
  text,
  html,
  notificationName,
) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.warn(
      `${notificationName} email not sent: SMTP settings are not configured.`,
    );
    return false;
  }

  try {
    const transporter = await makeTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: user.email,
      subject,
      text,
      html,
    });
    return true;
  } catch (error) {
    console.error(`${notificationName} email delivery failed:`, error.message);
    return false;
  }
}

async function sendLoginNotice(user, action, notificationName) {
  const safeName = escapeHtml(user.name);
  const safeAction = escapeHtml(action);
  const text = `Hello ${user.name}, a ${action} was detected on your Student Management account. If this was not you, reset your password and contact an administrator.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2>Account security notice</h2><p>Hello ${safeName},</p><p>A <strong>${safeAction}</strong> was detected on your Student Management account.</p><p>If this was not you, reset your password and contact an administrator.</p></body></html>`;

  return sendNotice(
    user,
    `Student Management account ${action}`,
    text,
    html,
    notificationName,
  );
}

export async function sendLoginEmail(user) {
  return sendLoginNotice(user, "sign-in", "Login notification");
}

export async function sendLogoutEmail(user) {
  return sendLoginNotice(user, "sign-out", "Logout notification");
}

export async function sendFailedLoginEmail(user) {
  const accountId = String(user._id || user.email);
  const currentTime = Date.now();
  const lastNoticeTime = failedLoginNotices.get(accountId);

  if (lastNoticeTime && currentTime - lastNoticeTime < failedLoginNoticeDelay) {
    return false;
  }

  for (const [savedAccountId, savedTime] of failedLoginNotices) {
    if (currentTime - savedTime >= failedLoginNoticeDelay) {
      failedLoginNotices.delete(savedAccountId);
    }
  }

  failedLoginNotices.set(accountId, currentTime);
  return sendLoginNotice(
    user,
    "incorrect password attempt",
    "Failed login notification",
  );
}

export async function sendRegisterEmail(user) {
  const safeName = escapeHtml(user.name);
  const role = user.role === "student" ? "Student" : "Viewer";
  return sendNotice(
    user,
    "Your Student Management account",
    `Hello ${user.name}, your account has been created with ${role} access.`,
    `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2>Welcome</h2><p>Hello ${safeName},</p><p>Your account has been created with <strong>${role}</strong> access.</p></body></html>`,
    "Account registration",
  );
}

export async function sendRoleEmail(user, oldRole) {
  const safeName = escapeHtml(user.name);
  const safeOldRole = escapeHtml(oldRole);
  const newRole = escapeHtml(user.role);
  return sendNotice(
    user,
    "Your account role has changed",
    `Hello ${user.name}, your account role changed from ${oldRole} to ${user.role}. Contact an administrator if you did not expect this change.`,
    `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2>Account role updated</h2><p>Hello ${safeName},</p><p>Your account role changed from <strong>${safeOldRole}</strong> to <strong>${newRole}</strong>.</p><p>Contact an administrator if you did not expect this change.</p></body></html>`,
    "User role change",
  );
}

export async function sendStudentRecordEmail(student) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.warn(
      "Enrollment email not sent: SMTP settings are not configured.",
    );
    return { sent: false, reason: "not-configured" };
  }

  const sender = process.env.EMAIL_FROM || process.env.SMTP_USER;

  try {
    const transporter = await makeTransporter();
    await transporter.sendMail({
      from: sender,
      to: student.email,
      subject: "Enrollment confirmation",
      text: `Hello ${student.name}, your student record has been created.`,
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2>Student record created</h2><p>Hello ${escapeHtml(student.name)},</p><p>Your student record has been created.</p><p>Thank you.</p></body></html>`,
    });
    return { sent: true };
  } catch (error) {
    console.error("Enrollment email delivery failed:", error.message);
    return { sent: false, reason: "delivery-failed" };
  }
}

export async function sendResetEmail(user, link) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.warn(
      "Password reset email not sent: SMTP settings are not configured.",
    );
    return false;
  }

  try {
    const transporter = await makeTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: "Reset your Student Management password",
      text: `Hello ${user.name}, use this link to reset your password. It expires in one hour: ${link}`,
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2>Password reset</h2><p>Hello ${escapeHtml(user.name)},</p><p>Use the link below to choose a new password. It expires in one hour.</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you did not request this, ignore this email.</p></body></html>`,
    });
    return true;
  } catch (error) {
    console.error("Password reset email delivery failed:", error.message);
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character];
  });
}
