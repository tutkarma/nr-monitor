/*
  # Initial schema for travel monitoring

  1. New Tables
    - `trips`
      - `id` (uuid, primary key)
      - `title` (text) - Trip title
      - `month` (text) - Month of the trip
      - `current_participants` (integer) - Current number of participants
      - `min_participants` (integer) - Minimum required participants
      - `max_participants` (integer) - Maximum allowed participants
      - `last_updated` (timestamptz) - Last time the data was updated
      - `vk_url` (text) - URL to the VK post
    
    - `subscriptions`
      - `id` (uuid, primary key)
      - `trip_id` (uuid, foreign key to trips)
      - `chat_id` (bigint) - Telegram chat ID
      - `created_at` (timestamptz)

    - `participant_history`
      - `id` (uuid, primary key)
      - `trip_id` (uuid, foreign key to trips)
      - `participants` (integer)
      - `recorded_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for service role access
*/

-- Create trips table
CREATE TABLE trips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    month integer NOT NULL CHECK (month >= 1 AND month <= 12),
    current_participants integer NOT NULL,
    min_participants integer NOT NULL,
    max_participants integer NOT NULL,
    last_updated timestamptz DEFAULT now(),
    vk_url text NOT NULL
);

-- Create subscriptions table
CREATE TABLE subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
    chat_id bigint NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(trip_id, chat_id)
);

-- Create participant history table
CREATE TABLE participant_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
    participants integer NOT NULL,
    recorded_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_history ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Service can manage trips"
    ON trips
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service can manage subscriptions"
    ON subscriptions
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service can manage participant history"
    ON participant_history
    TO service_role
    USING (true)
    WITH CHECK (true);