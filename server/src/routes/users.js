import { Router } from "express";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { sendRoleEmail } from "../services/emailService.js";
import { isValidRole } from "../utils/query.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/", async (_req, res, next) => {
  try {
    const users = await User.find()
      .select("name email role studentProfile createdAt")
      .sort({ createdAt: -1 });
    res.json({
      items: users.map((user) => ({
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        studentProfile: user.studentProfile || null,
        createdAt: user.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/role", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};
    if (!isValidRole(role))
      return res
        .status(400)
        .json({ message: "Role must be admin, staff, student, or viewer." });

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (role === "student" && !user.studentProfile) {
      return res.status(400).json({
        message: "Student access requires a student profile.",
      });
    }

    const oldRole = user.role;
    if (oldRole === role) {
      return res.json({
        user: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
        },
        emailNotificationSent: null,
      });
    }

    if (String(user._id) === String(req.user._id) && role !== "admin") {
      return res
        .status(400)
        .json({ message: "You cannot remove your own Admin role." });
    }

    if (user.role === "admin" && role !== "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1)
        return res
          .status(400)
          .json({ message: "The last Admin account cannot be demoted." });
    }

    user.role = role;
    await user.save();
    const emailNotificationSent = await sendRoleEmail(
      user,
      oldRole,
    );
    res.json({
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      emailNotificationSent,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account." });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    if (
      user.role === "admin" &&
      (await User.countDocuments({ role: "admin" })) <= 1
    ) {
      return res
        .status(400)
        .json({ message: "The last Admin account cannot be deleted." });
    }

    await user.deleteOne();
    res.json({ message: "User deleted." });
  } catch (error) {
    next(error);
  }
});

export default router;
