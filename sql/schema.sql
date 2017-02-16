
CREATE TABLE IF NOT EXISTS "users"(
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password" TEXT NOT NULL,
  "phone" SERIAL NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "accounts"(
  "id" SERIAL PRIMARY KEY,
  "user" INT REFERENCES users(id),
  "username" TEXT NOT NULL,
);