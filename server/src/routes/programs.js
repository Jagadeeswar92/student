import { Router } from "express";
import mongoose from "mongoose";
import Course from "../models/Course.js";
import Program from "../models/Program.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { escapeRegex } from "../utils/query.js";

const router = Router();

function validateProgram(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  const unexpected = Object.keys(body).find(
    (field) => !["name", "durationYears"].includes(field),
  );
  if (unexpected) return `Unexpected field: ${unexpected}.`;

  if (
    !partial &&
    (typeof body.name !== "string" || body.name.trim().length < 2)
  ) {
    return "Course or program name must contain at least 2 characters.";
  }
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" ||
      body.name.trim().length < 2 ||
      body.name.trim().length > 120)
  ) {
    return "Course or program name must contain 2 to 120 characters.";
  }
  if (
    (!partial || body.durationYears !== undefined) &&
    (!Number.isInteger(Number(body.durationYears)) ||
      Number(body.durationYears) < 1 ||
      Number(body.durationYears) > 6)
  ) {
    return "Program duration must be a whole number from 1 to 6 years.";
  }
  return "";
}

function formatProgram(program) {
  return {
    id: String(program._id),
    name: program.name,
    durationYears: program.durationYears,
    createdAt: program.createdAt,
    updatedAt: program.updatedAt,
  };
}

router.get("/options", async (_req, res, next) => {
  try {
    const programs = await Program.find()
      .select("name durationYears")
      .sort({ name: 1 })
      .lean();
    res.json({ items: programs.map(formatProgram) });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth, requireAdmin);

router.get("/", async (_req, res, next) => {
  try {
    const programs = await Program.find().sort({ name: 1 }).lean();
    res.json({ items: programs.map(formatProgram) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const message = validateProgram(req.body);
    if (message) return res.status(400).json({ message });

    const name = req.body.name.trim();
    if (await Program.exists({ key: name.toLowerCase() })) {
      return res.status(409).json({
        message: "A course or program with this name already exists.",
      });
    }
    const program = await Program.create({
      name,
      key: name.toLowerCase(),
      durationYears: Number(req.body.durationYears),
    });
    res.status(201).json({ program: formatProgram(program) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const message = validateProgram(req.body, true);
    if (message) return res.status(400).json({ message });

    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Program not found." });

    const oldName = program.name;
    const newName = req.body.name?.trim() || oldName;
    const newKey = newName.toLowerCase();
    if (newKey !== program.key && (await Program.exists({ key: newKey }))) {
      return res.status(409).json({
        message: "A course or program with this name already exists.",
      });
    }

    if (newName === oldName) {
      if (req.body.durationYears !== undefined) {
        program.durationYears = Number(req.body.durationYears);
      }
      await program.save();
      return res.json({ program: formatProgram(program) });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const oldNamePattern = new RegExp(`^${escapeRegex(oldName)}$`, "i");
        await Course.updateMany(
          { degree: oldNamePattern },
          { $set: { degree: newName } },
          { session },
        );
        await Student.updateMany(
          { degree: oldNamePattern },
          { $set: { degree: newName } },
          { session },
        );
        await User.updateMany(
          { "studentProfile.program": oldNamePattern },
          { $set: { "studentProfile.program": newName } },
          { session },
        );
        program.name = newName;
        program.key = newKey;
        if (req.body.durationYears !== undefined) {
          program.durationYears = Number(req.body.durationYears);
        }
        await program.save({ session });
      });
    } finally {
      await session.endSession();
    }
    res.json({ program: formatProgram(program) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Program not found." });

    const namePattern = new RegExp(`^${escapeRegex(program.name)}$`, "i");
    const [courseCount, studentCount, userCount] =
      await Promise.all([
        Course.countDocuments({ degree: namePattern }),
        Student.countDocuments({ degree: namePattern }),
        User.countDocuments({ "studentProfile.program": namePattern }),
      ]);
    if (courseCount + studentCount + userCount > 0) {
      return res.status(409).json({
        message: "This program is in use and cannot be deleted.",
      });
    }

    await program.deleteOne();
    res.json({ message: "Course or program deleted." });
  } catch (error) {
    next(error);
  }
});

export default router;
