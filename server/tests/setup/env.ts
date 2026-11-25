// Runs before each test file imports the app: point everything at the test database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vehicle_access:vehicle_access@127.0.0.1:5432/vehicle_access_test";
process.env.JWT_SECRET = "test-only-not-a-secret-".repeat(3);
process.env.CORS_ORIGINS = "http://127.0.0.1:5173";
