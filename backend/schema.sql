-- Create tables for ohmyclaude database

-- Drop tables if they exist (for clean setup)
DROP TABLE IF EXISTS data_entries CASCADE;

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    desc TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)

-- Create data_entries table
CREATE TABLE claims (
    id SERIAL PRIMARY KEY,
    content JSONB NOT NULL,
    document_id FOREIGN KEY REFERENCES documents(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on created_at for faster queries
CREATE INDEX idx_data_entries_created_at ON data_entries(created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_data_entries_updated_at
    BEFORE UPDATE ON data_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

