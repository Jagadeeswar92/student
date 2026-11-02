import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

test("health endpoint reports when MongoDB is disconnected", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const data = await response.json();

  assert.equal(response.status, 503);
  assert.equal(data.status, "unavailable");
  assert.equal(data.database, "disconnected");
});

test("API root explains that the server is running", async () => {
  const response = await fetch(`${baseUrl}/`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.service, "mern-practice-api");
  assert.equal(data.health, "/api/health");
});

test("CORS preflight responses are cacheable to avoid repeated browser round trips", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5174",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-max-age"), "86400");
});

test("CORS allows the configured Render frontend", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://client-kpqq.onrender.com",
      "Access-Control-Request-Method": "GET",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://client-kpqq.onrender.com",
  );
});

test("student endpoints require authentication", async () => {
  const response = await fetch(`${baseUrl}/api/students`);
  const data = await response.json();

  assert.equal(response.status, 401);
  assert.match(data.message, /sign in/i);
});

test("academic catalog routes require authentication", async () => {
  for (const route of ["/api/courses", "/api/instructors", "/api/programs"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 401);
  }
});

test("unknown routes return a JSON 404 response", async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.match(data.message, /route not found/i);
});

test("JSON null bodies are rejected with a readable validation response", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.message, "Request body contains invalid JSON.");
});

test("malformed JSON is rejected with a readable error", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad json",
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.message, "Request body contains invalid JSON.");
});

test("student registration validates details and password before database access", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Student", email: "student@example.com" }),
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.message, "Please correct the highlighted information.");
  assert.ok(data.errors.some((error) => error.field === "password"));
});

test("registration details reject incomplete requests before database access", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Student" }),
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.message, "Please correct the highlighted information.");
});

test("student registration requires a supported gender before database access", async () => {
  const registration = {
    firstName: "College",
    lastName: "Student",
    email: "gender-check@example.com",
    rollNumber: "CS2026001",
    phone: "+15551234567",
    address: "42 College Road",
    program: "B-Tech",
    branch: "Computer Science",
    yearOfStudy: 1,
    passingOutYear: 2030,
  };

  for (const gender of [undefined, "invalid"]) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...registration,
        ...(gender === undefined ? {} : { gender }),
        password: "StrongPassword123!",
      }),
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.message, "Please correct the highlighted information.");
    assert.ok(data.errors.some((error) => error.field === "gender"));
  }
});

test("registration validates the fixed course options and study-year limits", async () => {
  const registration = {
    firstName: "College",
    lastName: "Student",
    email: "academic-check@example.com",
    rollNumber: "CS2026002",
    gender: "Other",
    phone: "+15551234567",
    address: "42 College Road",
    program: "B-Tech",
    branch: "Others",
    yearOfStudy: 1,
    passingOutYear: 2030,
    password: "StrongPassword123!",
  };

  for (const invalidValues of [
    { program: "B.Tech" },
    { yearOfStudy: 5 },
  ]) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...registration, ...invalidValues }),
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    if (invalidValues.program) {
      assert.ok(data.errors.some((error) => error.field === "program"));
    } else {
      assert.match(data.message, /Year of study must be between 1 and 4/);
    }
  }
});

test("retired registration email-verification endpoints return 404", async () => {
  for (const route of [
    "/api/auth/registration/start",
    "/api/auth/registration/send-otp",
    "/api/auth/registration/verify",
  ]) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await response.json();

    assert.equal(response.status, 404);
    assert.match(data.message, /route not found/i);
  }
});

test("student registration rejects weak passwords", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "College",
      lastName: "Student",
      email: "weak-password@example.com",
      rollNumber: "CS2026003",
      gender: "Other",
      phone: "+15551234567",
      address: "42 College Road",
      program: "B-Tech",
      branch: "Others",
      yearOfStudy: 1,
      passingOutYear: 2030,
      password: "weakpass123",
    }),
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.ok(
    data.errors.some((error) =>
      error.message.includes("uppercase, lowercase, number, and special"),
    ),
  );
});
