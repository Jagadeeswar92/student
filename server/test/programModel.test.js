import test from "node:test";
import assert from "node:assert/strict";
import Course from "../src/models/Course.js";
import Program from "../src/models/Program.js";
import Student from "../src/models/Student.js";
import User from "../src/models/User.js";

test("program names are database-managed strings rather than fixed enums", () => {
  assert.deepEqual(Program.schema.path("name").enumValues, []);
  assert.deepEqual(Course.schema.path("degree").enumValues, []);
  assert.deepEqual(Student.schema.path("degree").enumValues, []);
  assert.deepEqual(
    User.schema.path("studentProfile").schema.path("program").enumValues,
    [],
  );
});

test("program catalog entries require a name, unique key, and duration", () => {
  assert.equal(Program.schema.path("name").isRequired, true);
  assert.equal(Program.schema.path("key").isRequired, true);
  assert.equal(Program.schema.path("key").options.unique, true);
  assert.equal(Program.schema.path("durationYears").isRequired, true);
});
