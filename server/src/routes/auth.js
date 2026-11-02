import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import {
  sendFailedLoginEmail,
  sendLoginEmail,
  sendLogoutEmail,
  sendRegisterEmail,
  sendResetEmail,
} from "../services/emailService.js";
import { cleanEmail, isValidPhone } from "../utils/query.js";
import { runInBackground } from "../utils/runInBackground.js";
import { getRegistrationProgram, registrationPrograms } from "../utils/academicOptions.js";
import { isStrongPassword } from "../utils/passwordValidation.js";

const router = Router();

function getPasswordRules() {
  return body("password")
    .isString()
    .isLength({ min: 8, max: 100 })
    .withMessage("Password must contain 8 to 100 characters.");
}

function sendErrors(req, res) {
  const result = validationResult(req);
  if (result.isEmpty()) return false;

  res.status(400).json({
    message: "Please correct the highlighted information.",
    errors: result
      .array()
      .map((item) => ({ field: item.path, message: item.msg })),
  });
  return true;
}

function makeToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
    },
  );
}

function getPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    studentProfile: user.role === "student" ? user.studentProfile || null : null,
  };
}

const registrationDetailsRules = [
  body("firstName")
    .isString()
    .trim()
    .isLength({ min: 1, max: 60 })
    .withMessage("First name must contain 1 to 60 characters."),
  body("lastName")
    .isString()
    .trim()
    .isLength({ min: 1, max: 60 })
    .withMessage("Last name must contain 1 to 60 characters."),
  body("email").isEmail().normalizeEmail(),
  body("rollNumber")
    .isString()
    .trim()
    .isLength({ min: 2, max: 40 })
    .matches(/^[A-Za-z0-9][A-Za-z0-9/-]*$/)
    .withMessage("Enter a valid college roll number."),
  body("gender")
    .isIn(["Male", "Female", "Other"])
    .withMessage("Choose a valid gender."),
  body("phone")
    .isString()
    .custom(isValidPhone)
    .withMessage("Enter a valid phone number with 10 to 15 digits."),
  body("program")
    .isString()
    .trim()
    .isIn(registrationPrograms.map((program) => program.name))
    .withMessage("Choose a valid course of study."),
  body("branch")
    .isString()
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Branch must contain 2 to 80 characters."),
  body("address")
    .isString()
    .trim()
    .isLength({ min: 5, max: 300 })
    .withMessage("Address must contain 5 to 300 characters."),
  body("yearOfStudy").isInt({ min: 1, max: 6 }).toInt(),
  body("passingOutYear").isInt({ min: 1980, max: 2100 }).toInt(),
];

router.post(
  "/register",
  [
    ...registrationDetailsRules,
    body("password")
      .isString()
      .custom(isStrongPassword)
      .withMessage(
        "Password must be 8 to 100 characters and include uppercase, lowercase, number, and special characters.",
      ),
  ],
  async (req, res, next) => {
    try {
      if (sendErrors(req, res)) return;

      const {
        firstName,
        lastName,
        email,
        rollNumber,
        gender,
        phone,
        address,
        program: requestedProgram,
        branch,
      } = req.body;
      const program = getRegistrationProgram(requestedProgram);
      if (!program) {
        return res.status(400).json({
          message: "Choose a valid course of study.",
        });
      }
      if (`${firstName.trim()} ${lastName.trim()}`.length > 100) {
        return res.status(400).json({
          message: "First and last name together must be 100 characters or fewer.",
        });
      }

      const yearOfStudy = Number(req.body.yearOfStudy);
      const passingOutYear = Number(req.body.passingOutYear);
      if (yearOfStudy > program.durationYears) {
        return res.status(400).json({
          message: `Year of study must be between 1 and ${program.durationYears} for ${program.name}.`,
        });
      }

      const normalizedEmail = cleanEmail(email);
      const normalizedRollNumber = rollNumber.trim().toUpperCase();
      if (await User.exists({ email: normalizedEmail })) {
        return res.status(409).json({
          message: "An account already exists for this email. Please sign in.",
        });
      }
      if (
        await User.exists({
          "studentProfile.rollNumber": normalizedRollNumber,
        })
      ) {
        return res.status(409).json({
          message: "That college roll number is already registered.",
        });
      }

      const user = await User.create({
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(req.body.password, 12),
        role: "student",
        studentProfile: {
          rollNumber: normalizedRollNumber,
          gender,
          phone: phone.trim(),
          address: address.trim(),
          program: program.name,
          branch: branch.trim(),
          yearOfStudy,
          passingOutYear,
        },
      });
      const emailNotificationSent = await sendRegisterEmail(user);

      res.status(201).json({
        message: "Your student account was created successfully.",
        user: getPublicUser(user),
        emailNotificationSent,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/login",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isString().isLength({ min: 1, max: 100 }),
  ],
  async (req, res, next) => {
    try {
      if (sendErrors(req, res)) return;

      const user = await User.findOne({
        email: cleanEmail(req.body.email),
      })
        .select("+passwordHash")
        .lean();
      const passwordMatches =
        user && (await bcrypt.compare(req.body.password, user.passwordHash));

      if (!passwordMatches) {
        if (user) {
          runInBackground(
            () => sendFailedLoginEmail(user),
            "Failed login notification",
          );
        }
        return res
          .status(401)
          .json({ message: "Email or password is incorrect." });
      }

      res.json({ token: makeToken(user), user: getPublicUser(user) });
      runInBackground(() => sendLoginEmail(user), "Login notification");
    } catch (error) {
      next(error);
    }
  },
);

router.post("/logout", requireAuth, (req, res) => {
  res.json({ message: "You have been signed out." });
  runInBackground(() => sendLogoutEmail(req.user), "Logout notification");
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: getPublicUser(req.user) });
});

router.patch(
  "/me",
  requireAuth,
  [
    body("name").optional().trim().isLength({ min: 2, max: 100 }),
    body("email").optional().isEmail().normalizeEmail(),
  ],
  async (req, res, next) => {
  try {
    if (sendErrors(req, res)) return;
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.email !== undefined) {
      updates.email = cleanEmail(req.body.email);
    }

      const user = await User.findByIdAndUpdate(req.user._id, updates, {
        new: true,
        runValidators: true,
      });
      res.json({ user: getPublicUser(user) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/change-password",
  requireAuth,
  [
    body("currentPassword").isString().isLength({ min: 1, max: 100 }),
    getPasswordRules(),
  ],
  async (req, res, next) => {
    try {
      if (sendErrors(req, res)) return;
      const user = await User.findById(req.user._id).select("+passwordHash");
      const matches =
        user &&
        (await bcrypt.compare(req.body.currentPassword, user.passwordHash));
      if (!matches)
        return res
          .status(400)
          .json({ message: "Current password is incorrect." });

      user.passwordHash = await bcrypt.hash(req.body.password, 12);
      await user.save();
      res.json({
        message: "Password changed successfully. Sign in again if prompted.",
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/forgot-password",
  [body("email").isEmail().normalizeEmail()],
  async (req, res, next) => {
    try {
      if (sendErrors(req, res)) return;

      const email = cleanEmail(req.body.email);
      const user = await User.findOne({ email });

      if (user) {
        const token = randomBytes(32).toString("hex");
        user.passwordResetTokenHash = createHash("sha256")
          .update(token)
          .digest("hex");
        user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
        await user.save();

        const frontendUrl =
          process.env.FRONTEND_URL ||
          process.env.CLIENT_ORIGIN ||
          "http://localhost:5174";
        const link = `${frontendUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
        await sendResetEmail(user, link);
      }

      res.json({
        message:
          "If an account uses that email, password reset instructions have been sent.",
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/reset-password",
  [body("token").isString().isLength({ min: 32, max: 200 }), getPasswordRules()],
  async (req, res, next) => {
    try {
      if (sendErrors(req, res)) return;
      const tokenHash = createHash("sha256")
        .update(req.body.token)
        .digest("hex");
      const user = await User.findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() },
      }).select("+passwordHash +passwordResetTokenHash +passwordResetExpires");

      if (!user)
        return res
          .status(400)
          .json({ message: "The reset link is invalid or has expired." });

      user.passwordHash = await bcrypt.hash(req.body.password, 12);
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpires = undefined;
      await user.save();
      res.json({
        message: "Password reset successfully. You can now sign in.",
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
