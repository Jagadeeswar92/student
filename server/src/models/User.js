import mongoose from "mongoose";

const studentProfileSchema = new mongoose.Schema(
  {
    rollNumber: { type: String, required: true, trim: true, maxlength: 40 },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    program: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    branch: { type: String, required: true, trim: true, maxlength: 80 },
    yearOfStudy: { type: Number, required: true, min: 1, max: 6 },
    passingOutYear: { type: Number, required: true, min: 1980, max: 2100 },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "staff", "student", "viewer"],
      default: "viewer",
    },
    studentProfile: { type: studentProfileSchema, default: undefined },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.index(
  { "studentProfile.rollNumber": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "studentProfile.rollNumber": { $type: "string" },
    },
  },
);

export default mongoose.model("User", userSchema);
