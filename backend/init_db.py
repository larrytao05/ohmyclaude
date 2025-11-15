#!/usr/bin/env python3
"""
Database initialization script.
Creates tables and schema for the ohmyclaude database.
"""

import psycopg2
import os
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# Database connection parameters
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5433'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'postgres'),
    'database': os.getenv('DB_NAME', 'ohmyclaude_db')
}


def read_schema_file():
    """Read the schema.sql file"""
    schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
    with open(schema_path, 'r') as f:
        return f.read()


def init_database():
    """Initialize the database with schema"""
    try:
        # Connect to PostgreSQL
        print(f"Connecting to database {DB_CONFIG['database']}...")
        conn = psycopg2.connect(**DB_CONFIG)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Read and execute schema
        print("Reading schema file...")
        schema_sql = read_schema_file()
        
        print("Creating tables and schema...")
        cursor.execute(schema_sql)
        
        print("✓ Database schema created successfully!")
        
        # Verify tables were created
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = cursor.fetchall()
        print(f"\nCreated tables: {[table[0] for table in tables]}")
        
        cursor.close()
        conn.close()
        
    except psycopg2.OperationalError as e:
        print(f"✗ Error connecting to database: {e}")
        print("\nMake sure PostgreSQL is running:")
        print("  docker-compose up -d")
        return False
    except Exception as e:
        print(f"✗ Error initializing database: {e}")
        return False
    
    return True


if __name__ == '__main__':
    print("=" * 50)
    print("Database Initialization Script")
    print("=" * 50)
    success = init_database()
    if success:
        print("\n✓ Database initialization complete!")
    else:
        print("\n✗ Database initialization failed!")
        exit(1)

