#!/usr/bin/env python3
"""
Quick utility to check if Neo4j is running and accessible.
"""

import sys
from graph_utils import Neo4jGraph


def check_neo4j():
    """Check if Neo4j is running and accessible"""
    print("Checking Neo4j connection...")
    print("=" * 50)
    
    try:
        graph = Neo4jGraph()
        
        # Try to get graph stats (simple query to test connection)
        stats = graph.get_graph_stats()
        
        print("✓ Neo4j is running and accessible!")
        print(f"  URI: {graph.uri}")
        print(f"  User: {graph.user}")
        print(f"  Nodes: {stats['nodes']}")
        print(f"  Relationships: {stats['relationships']}")
        
        graph.close()
        return True
        
    except Exception as e:
        print("✗ Neo4j is not accessible")
        print(f"  Error: {e}")
        print("\nTroubleshooting:")
        print("  1. Check if Neo4j container is running:")
        print("     docker-compose ps")
        print("  2. Start Neo4j if not running:")
        print("     docker-compose up -d neo4j")
        print("  3. Check container logs:")
        print("     docker-compose logs neo4j")
        print("  4. Access Neo4j Browser at: http://localhost:7474")
        return False


if __name__ == '__main__':
    success = check_neo4j()
    sys.exit(0 if success else 1)

