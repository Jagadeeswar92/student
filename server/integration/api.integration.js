import "dotenv/config";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import User from "../src/models/User.js";
import Student from "../src/models/Student.js";
import Course from "../src/models/Course.js";
import Instructor from "../src/models/Instructor.js";
import Program from "../src/models/Program.js";
import {
  documentFolder,
  photoFolder,
} from "../src/utils/files.js";

const testMongoUri = process.env.TEST_MONGO_URI;
if (!testMongoUri) {
  throw new Error(
    "Set TEST_MONGO_URI to a MongoDB test cluster before running test:integration. A unique temporary database will be created and dropped.",
  );
}

const dnsServers = (process.env.MONGO_DNS_SERVERS || "")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

process.env.CLIENT_ORIGIN =
  process.env.TEST_CLIENT_ORIGIN ||
  process.env.CLIENT_ORIGIN ||
  "https://localhost:5174";
for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
  delete process.env[key];
}

const { default: app } = await import("../src/app.js");
const databaseName = `student_management_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
const emailTag = randomUUID();
const testPassword = "IntegrationPassphrase42!";
let server;
let baseUrl;
let admin;
let staff;
let studentUser;
let viewer;
let roleTokens;
let initialPhotos = new Set();
let initialDocuments = new Set();

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.role) {
    headers.Authorization = `Bearer ${roleTokens[options.role]}`;
  }

  const init = { method: options.method || "GET", headers };
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, status: response.status, data };
}

function createTestFile(field, name, type, content) {
  const formData = new FormData();
  formData.append(field, new Blob([content], { type }), name);
  return formData;
}

before(async () => {
  await mongoose.connect(testMongoUri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 10000,
  });
  await Promise.all([
    User.init(),
    Student.init(),
    Course.init(),
    Instructor.init(),
    Program.init(),
  ]);
  await Program.create([
    { name: "B.Tech", key: "b.tech", durationYears: 4 },
    { name: "M.Tech", key: "m.tech", durationYears: 2 },
    { name: "Degree", key: "degree", durationYears: 3 },
    { name: "Pharmacy", key: "pharmacy", durationYears: 6 },
  ]);

  const passwordHash = await bcrypt.hash(testPassword, 4);
  [admin, staff, studentUser, viewer] = await User.create([
    {
      name: "Integration Admin",
      email: `admin-${emailTag}@example.invalid`,
      passwordHash,
      role: "admin",
    },
    {
      name: "Integration Staff",
      email: `staff-${emailTag}@example.invalid`,
      passwordHash,
      role: "staff",
    },
    {
      name: "Integration Student",
      email: `student-${emailTag}@example.invalid`,
      passwordHash,
      role: "student",
      studentProfile: {
        rollNumber: `IT${Date.now()}`,
        phone: "+15551234567",
        address: "42 Integration Test Road",
        program: "B-Tech",
        branch: "Computer Science",
        yearOfStudy: 2,
        passingOutYear: 2028,
      },
    },
    {
      name: "Integration Viewer",
      email: `viewer-${emailTag}@example.invalid`,
      passwordHash,
      role: "viewer",
    },
  ]);

  roleTokens = Object.fromEntries(
    [admin, staff, studentUser, viewer].map((user) => [
      user.role,
      jwt.sign(
        { sub: String(user._id), role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "10m" },
      ),
    ]),
  );

  await Student.create({
    name: "Integration Student Record",
    email: `record-${emailTag}@example.invalid`,
    mobile: "+15551234567",
    gender: "Other",
    address: "42 Integration Test Road",
    status: "enrolled",
  });

  initialPhotos = new Set(await fs.readdir(photoFolder));
  initialDocuments = new Set(await fs.readdir(documentFolder));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));

  for (const [folder, initialFiles] of [
    [photoFolder, initialPhotos],
    [documentFolder, initialDocuments],
  ]) {
    for (const filename of await fs.readdir(folder)) {
      if (!initialFiles.has(filename)) {
        await fs.unlink(`${folder}/${filename}`).catch(() => {});
      }
    }
  }

  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("health, CORS, and authentication boundaries", async () => {
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.database, "connected");

  const root = await request("/");
  assert.equal(root.status, 200);
  assert.equal(root.data.service, "mern-practice-api");

  for (const path of ["/api/students", "/api/dashboard"]) {
    assert.equal((await request(path)).status, 401);
  }
  assert.equal((await request("/api/courses")).status, 401);
  assert.equal((await request("/api/instructors")).status, 401);

  const preflight = await fetch(`${baseUrl}/api/health`, {
    method: "OPTIONS",
    headers: {
      Origin: process.env.TEST_CLIENT_ORIGIN || "https://localhost:5174",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    process.env.TEST_CLIENT_ORIGIN || "https://localhost:5174",
  );
});

test("student data and dashboard are Admin-only; students can read their profile", async () => {
  assert.equal((await request("/api/students", { role: "admin" })).status, 200);
  for (const role of ["staff", "student", "viewer"]) {
    assert.equal((await request("/api/students", { role })).status, 403);
    assert.equal((await request("/api/dashboard", { role })).status, 403);
  }

  const ownProfile = await request("/api/auth/me", { role: "student" });
  assert.equal(ownProfile.status, 200);
  assert.equal(
    ownProfile.data.user.studentProfile.rollNumber,
    studentUser.studentProfile.rollNumber,
  );
  assert.equal(ownProfile.data.user.studentProfile.address, "42 Integration Test Road");

  const dashboard = await request("/api/dashboard", { role: "admin" });
  assert.equal(dashboard.status, 200);
  assert.ok(
    dashboard.data.departmentDistribution.some(
      (item) =>
        item.department === "Unassigned department" &&
        item.degree === "Unspecified degree",
    ),
  );

  assert.equal((await request("/api/users", { role: "admin" })).status, 200);
  assert.equal((await request("/api/users", { role: "staff" })).status, 403);
});

test("student CRUD, import/export, and upload routes", async () => {
  assert.equal(
    (await request("/api/students", { role: "staff", method: "POST", body: {} })).status,
    403,
  );
  const invalid = await request("/api/students", { role: "admin", method: "POST", body: {} });
  assert.equal(invalid.status, 400);

  const studentBody = {
    name: "CRUD Student",
    email: `crud-${emailTag}@example.invalid`,
    mobile: "+15557654321",
    gender: "Other",
    department: "Computer Science and Engineering",
    degree: "B.Tech",
    rollNumber: `CRUD-${emailTag.slice(0, 8).toUpperCase()}`,
    address: "CRUD Test Address",
    status: "enrolled",
  };
  const created = await request("/api/students", { role: "admin", method: "POST", body: studentBody });
  assert.equal(created.status, 201);
  const id = created.data.student.id;
  assert.equal(created.data.student.department, studentBody.department);
  assert.equal(created.data.student.degree, studentBody.degree);
  assert.equal(created.data.student.rollNumber, studentBody.rollNumber);
  assert.equal((await request("/api/students", { role: "admin", method: "POST", body: studentBody })).status, 409);
  const filteredStudents = await request(
    `/api/students?search=${encodeURIComponent(studentBody.rollNumber)}&department=${encodeURIComponent(studentBody.department)}&degree=B.Tech`,
    { role: "admin" },
  );
  assert.equal(filteredStudents.status, 200);
  assert.equal(filteredStudents.data.total, 1);
  assert.equal(filteredStudents.data.items[0].id, id);
  assert.ok(
    filteredStudents.data.departments.includes("Computer Science and Engineering"),
  );
  assert.ok(filteredStudents.data.departments.includes("CSE"));
  assert.deepEqual(filteredStudents.data.degrees, [
    "B.Tech",
    "Degree",
    "M.Tech",
    "Pharmacy",
  ]);
  const departmentSearch = await request(
    `/api/students?search=${encodeURIComponent(studentBody.department)}`,
    { role: "admin" },
  );
  assert.equal(departmentSearch.status, 200);
  assert.equal(departmentSearch.data.total, 1);
  assert.equal(departmentSearch.data.items[0].id, id);
  assert.equal((await request(`/api/students/${id}`, { role: "admin", method: "PATCH", body: { address: "Updated CRUD Address" } })).status, 200);
  assert.equal((await request(`/api/students/${id}`, { role: "admin" })).data.student.address, "Updated CRUD Address");

  for (const [format, mime] of [
    ["csv", "text/csv"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["pdf", "application/pdf"],
  ]) {
    const exported = await request(`/api/students/export/file?format=${format}`, { role: "admin" });
    assert.equal(exported.status, 200);
    assert.match(exported.response.headers.get("content-type"), new RegExp(mime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal((await request("/api/students/export/file?format=xml", { role: "admin" })).status, 400);

  const csv = [
    "name,email,mobile,gender,department,degree,rollNumber,address,status,passingYear",
    `Imported Student,import-${emailTag}@example.invalid,+15559876543,Other,Electrical Engineering,B.Tech,IMP-1,Import Address,enrolled,2030`,
    `Invalid Student,bad-${emailTag}@example.invalid,123,Other,Electrical Engineering,B.Tech,IMP-2,x,enrolled,2030`,
  ].join("\n");
  const importData = await request("/api/students/import", {
    role: "admin",
    method: "POST",
    formData: createTestFile("file", "students.csv", "text/csv", csv),
  });
  assert.equal(importData.status, 200);
  assert.equal(importData.data.insertedCount, 1);
  assert.equal(importData.data.errorCount, 1);

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const photo = await request(`/api/students/${id}/photo`, {
    role: "admin",
    method: "POST",
    formData: createTestFile("photo", "student.png", "image/png", pngSignature),
  });
  assert.equal(photo.status, 200);
  assert.equal((await request(`/api/students/${id}/photo`, { role: "admin" })).status, 200);
  assert.equal((await request(`/api/students/${id}/photo`, { role: "student" })).status, 403);
  assert.equal((await request(`/api/students/${id}/photo`, { role: "admin", method: "DELETE" })).status, 200);

  const document = await request(`/api/students/${id}/document`, {
    role: "admin",
    method: "POST",
    formData: createTestFile("document", "proof.pdf", "application/pdf", Buffer.from("%PDF-1.4\n")),
  });
  assert.equal(document.status, 200);
  assert.equal((await request(`/api/students/${id}/document`, { role: "admin" })).status, 200);
  assert.equal((await request(`/api/students/${id}/document`, { role: "staff" })).status, 403);
  assert.equal((await request(`/api/students/${id}/document`, { role: "admin", method: "DELETE" })).status, 200);

  const invalidFile = await request(`/api/students/${id}/photo`, {
    role: "admin",
    method: "POST",
    formData: createTestFile("photo", "bad.txt", "text/plain", "not an image"),
  });
  assert.equal(invalidFile.status, 400);
  assert.equal((await request(`/api/students/${id}`, { role: "admin", method: "DELETE" })).status, 200);
});

test("admin role management and direct student registration", async () => {
  assert.equal((await request("/api/users", { role: "staff" })).status, 403);
  assert.equal((await request(`/api/users/${admin._id}/role`, { role: "admin", method: "PATCH", body: { role: "staff" } })).status, 400);
  assert.equal((await request(`/api/users/${admin._id}`, { role: "admin", method: "DELETE" })).status, 400);
  assert.equal((await request(`/api/users/${viewer._id}/role`, { role: "admin", method: "PATCH", body: { role: "student" } })).status, 400);
  assert.equal((await request(`/api/users/${viewer._id}/role`, { role: "admin", method: "PATCH", body: { role: "staff" } })).status, 200);

  const duplicateEmail = await request("/api/auth/register", {
    method: "POST",
    body: {
      firstName: "Duplicate",
      lastName: "Student",
      email: studentUser.email,
      rollNumber: `D${Date.now()}`,
      gender: "Other",
      phone: "+15551234567",
      address: "Duplicate registration address",
      program: "B-Tech",
      branch: "Computer Science",
      yearOfStudy: 1,
      passingOutYear: 2030,
      password: testPassword,
    },
  });
  assert.equal(duplicateEmail.status, 409);

  const registration = {
    firstName: "Registered",
    lastName: "Student",
    email: `registered-${emailTag}@example.invalid`,
    rollNumber: `P${Date.now()}`,
    gender: "Other",
    phone: "+15551234567",
    address: "Student registration address",
    program: "B-Tech",
    branch: "Computer Science",
    yearOfStudy: 1,
    passingOutYear: 2030,
    password: testPassword,
  };
  const created = await request("/api/auth/register", {
    method: "POST",
    body: registration,
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.emailNotificationSent, false);
  assert.equal(created.data.user.role, "student");

  const savedUser = await User.findOne({ email: registration.email });
  assert.ok(savedUser);
  assert.equal(savedUser.studentProfile.rollNumber, registration.rollNumber.toUpperCase());
  assert.equal(await bcrypt.compare(testPassword, savedUser.passwordHash), true);
});

test("course and instructor CRUD, search, and assignment safeguards", async () => {
  for (const role of ["staff", "student", "viewer"]) {
    assert.equal((await request("/api/courses", { role })).status, 200);
    assert.equal((await request("/api/instructors", { role })).status, 200);
  }

  const invalidInstructor = await request("/api/instructors", {
    role: "admin",
    method: "POST",
    body: { name: "Incomplete" },
  });

  test("admins manage course/program options and protect options in use", async () => {
    const created = await request("/api/programs", {
      role: "admin",
      method: "POST",
      body: { name: "Bachelor of Computer Applications", durationYears: 3 },
    });
    assert.equal(created.status, 201);
    const programId = created.data.program.id;

    const publicOptions = await request("/api/programs/options");
    assert.equal(publicOptions.status, 200);
    assert.ok(
      publicOptions.data.items.some(
        (program) => program.name === "Bachelor of Computer Applications",
      ),
    );

    const duplicate = await request("/api/programs", {
      role: "admin",
      method: "POST",
      body: { name: "bachelor of computer applications", durationYears: 3 },
    });
    assert.equal(duplicate.status, 409);

    const renamed = await request(`/api/programs/${programId}`, {
      role: "admin",
      method: "PATCH",
      body: { name: "BCA", durationYears: 3 },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.program.name, "BCA");

    assert.equal(
      (await request(`/api/programs/${programId}`, {
        role: "admin",
        method: "DELETE",
      })).status,
      200,
    );
    assert.equal(
      (await request("/api/programs", {
        role: "staff",
        method: "POST",
        body: { name: "Unauthorized Program", durationYears: 3 },
      })).status,
      403,
    );
  });
  assert.equal(invalidInstructor.status, 400);

  const instructorBody = {
    name: "Catalog Instructor",
    email: `instructor-${emailTag}@example.invalid`,
    phone: "+15551234567",
    department: "Computer Science and Engineering",
    designation: "Assistant Professor",
    specialization: "Distributed Systems",
  };
  const createdInstructor = await request("/api/instructors", {
    role: "admin",
    method: "POST",
    body: instructorBody,
  });
  assert.equal(createdInstructor.status, 201);
  const instructorId = createdInstructor.data.instructor.id;

  const studentInstructor = await request(`/api/instructors/${instructorId}`, {
    role: "student",
  });
  assert.equal(studentInstructor.status, 200);
  assert.equal(studentInstructor.data.instructor.name, instructorBody.name);

  const instructorSearch = await request(
    `/api/instructors?search=${encodeURIComponent("Distributed Systems")}`,
    { role: "admin" },
  );
  assert.equal(instructorSearch.status, 200);
  assert.equal(instructorSearch.data.items[0].id, instructorId);

  const invalidCourse = await request("/api/courses", {
    role: "admin",
    method: "POST",
    body: { code: "BAD", name: "Bad Course" },
  });
  assert.equal(invalidCourse.status, 400);

  const courseBody = {
    code: `CS-${emailTag.slice(0, 8)}`,
    name: "Database Systems",
    department: "Computer Science and Engineering",
    degree: "B.Tech",
    credits: 4,
    description: "Relational and distributed database fundamentals.",
    instructorId,
  };
  const createdCourse = await request("/api/courses", {
    role: "admin",
    method: "POST",
    body: courseBody,
  });
  assert.equal(createdCourse.status, 201);
  const courseId = createdCourse.data.course.id;
  assert.equal(createdCourse.data.course.code, courseBody.code.toUpperCase());
  assert.equal(createdCourse.data.course.instructor.id, instructorId);

  const studentCourse = await request(`/api/courses/${courseId}`, {
    role: "student",
  });
  assert.equal(studentCourse.status, 200);
  assert.equal(studentCourse.data.course.name, courseBody.name);

  assert.equal(
    (
      await request("/api/courses", {
        role: "student",
        method: "POST",
        body: courseBody,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/instructors/${instructorId}`, {
        role: "student",
        method: "PATCH",
        body: { designation: "Unauthorized Change" },
      })
    ).status,
    403,
  );

  const duplicateCourse = await request("/api/courses", {
    role: "admin",
    method: "POST",
    body: courseBody,
  });
  assert.equal(duplicateCourse.status, 409);

  const courseSearch = await request(
    `/api/courses?search=${encodeURIComponent("Database Systems")}&department=${encodeURIComponent(courseBody.department)}&degree=B.Tech&instructorId=${instructorId}`,
    { role: "admin" },
  );
  assert.equal(courseSearch.status, 200);
  assert.equal(courseSearch.data.items.length, 1);
  assert.equal(courseSearch.data.items[0].id, courseId);

  const protectedDelete = await request(`/api/instructors/${instructorId}`, {
    role: "admin",
    method: "DELETE",
  });
  assert.equal(protectedDelete.status, 409);

  const updatedInstructor = await request(`/api/instructors/${instructorId}`, {
    role: "admin",
    method: "PATCH",
    body: { designation: "Associate Professor" },
  });
  assert.equal(updatedInstructor.status, 200);
  assert.equal(updatedInstructor.data.instructor.designation, "Associate Professor");

  const updatedCourse = await request(`/api/courses/${courseId}`, {
    role: "admin",
    method: "PATCH",
    body: { credits: 3, instructorId: null },
  });
  assert.equal(updatedCourse.status, 200);
  assert.equal(updatedCourse.data.course.credits, 3);
  assert.equal(updatedCourse.data.course.instructor, null);

  assert.equal(
    (await request(`/api/courses/${courseId}`, { role: "admin" })).data.course.name,
    "Database Systems",
  );
  assert.equal(
    (await request(`/api/courses/${courseId}`, {
      role: "admin",
      method: "DELETE",
    })).status,
    200,
  );
  assert.equal(
    (await request(`/api/instructors/${instructorId}`, {
      role: "admin",
      method: "DELETE",
    })).status,
    200,
  );
});