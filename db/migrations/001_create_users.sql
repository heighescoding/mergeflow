CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth_identifier TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
