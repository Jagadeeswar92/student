import jwt from "jsonwebtoken";
import User from "../models/User.js";

export async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({ message: "Please sign in to continue." });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } 
  catch (error) {
    return res.status(401).json({
      message: "Your session is invalid or expired. Please sign in again.",
    });
  }

  try {
    const user = await User.findById(payload.sub).select(
      "_id name email role studentProfile",
    );
    if (!user) {
      return res
        .status(401)
        .json({ message: "This account no longer exists." });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function allowRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "You do not have permission to do this." });
    }

    next();
  };
}

export const requireAdmin = allowRoles("admin");
export const requireStaffOrAdmin = allowRoles("admin", "staff");
