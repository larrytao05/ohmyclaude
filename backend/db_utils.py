import psycopg2

class DatabaseUtils:
    def __init__(self):
        self.db = Database(
            host=os.getenv('DB_HOST', 'localhost'),
            port=os.getenv('DB_PORT', '5432'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'postgres'),
            database=os.getenv('DB_NAME', 'ohmyclaude_db')
        )

    def create_document(self, description: str, content: str, title: str) -> dict:
        """Create a new project"""
        with self.db.connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"""
                    INSERT INTO documents (name) VALUES (%s) RETURNING id
                """, (description, content, title))
                return cursor.fetchone()[0]

    def get_project(self, project_id: int) -> dict:
        """Get a project by its ID"""
        return self.db.get_project(project_id)

