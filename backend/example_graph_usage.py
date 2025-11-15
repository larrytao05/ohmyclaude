#!/usr/bin/env python3
"""
Example script showing how to create graphs and add nodes to Neo4j.
Run this after starting Neo4j with: docker-compose up -d
"""

from graph_utils import Neo4jGraph


def example_create_graph():
    """Example: Create a graph with nodes and relationships"""
    
    # Initialize connection to Neo4j
    graph = Neo4jGraph()
    
    try:
        print("=" * 50)
        print("Creating Graph and Adding Nodes")
        print("=" * 50)
        
        # Example 1: Create a single node
        print("\n1. Creating a single node...")
        person_node = graph.create_node(
            label='Person',
            properties={'name': 'Alice', 'age': 30, 'role': 'Researcher'}
        )
        print(f"   Created node: {person_node}")
        
        # Example 2: Create multiple nodes at once
        print("\n2. Creating multiple nodes...")
        nodes = graph.create_nodes([
            {
                'label': 'Document',
                'properties': {'title': 'Research Paper 1', 'year': 2023}
            },
            {
                'label': 'Document',
                'properties': {'title': 'Research Paper 2', 'year': 2024}
            },
            {
                'label': 'Claim',
                'properties': {'text': 'Climate change is real'}
            },
            {
                'label': 'Claim',
                'properties': {'text': 'Renewable energy is cost-effective'}
            }
        ])
        print(f"   Created {len(nodes)} nodes")
        for node in nodes:
            print(f"   - {node['labels'][0]}: {node['properties']}")
        
        # Example 3: Create relationships between nodes
        print("\n3. Creating relationships...")
        
        # Person supports a claim
        relationship1 = graph.create_relationship(
            from_label='Person',
            from_property='name',
            from_value='Alice',
            to_label='Claim',
            to_property='text',
            to_value='Climate change is real',
            relationship_type='SUPPORTS',
            relationship_properties={'since': '2023-01-01'}
        )
        print(f"   Created relationship: {relationship1['from']['properties']['name']} "
              f"SUPPORTS {relationship1['to']['properties']['text']}")
        
        # Document supports a claim
        relationship2 = graph.create_relationship(
            from_label='Document',
            from_property='title',
            from_value='Research Paper 1',
            to_label='Claim',
            to_property='text',
            to_value='Climate change is real',
            relationship_type='SUPPORTS',
            relationship_properties={'page': 5, 'section': 'Introduction'}
        )
        print(f"   Created relationship: {relationship2['from']['properties']['title']} "
              f"SUPPORTS {relationship2['to']['properties']['text']}")
        
        # Claim conflicts with another claim
        relationship3 = graph.create_relationship(
            from_label='Claim',
            from_property='text',
            from_value='Climate change is real',
            to_label='Claim',
            to_property='text',
            to_value='Renewable energy is cost-effective',
            relationship_type='RELATED_TO',
            relationship_properties={'strength': 0.7}
        )
        print(f"   Created relationship: {relationship3['from']['properties']['text']} "
              f"RELATED_TO {relationship3['to']['properties']['text']}")
        
        # Example 4: Query nodes
        print("\n4. Querying nodes...")
        all_claims = graph.get_all_nodes('Claim')
        print(f"   Found {len(all_claims)} Claim nodes:")
        for claim in all_claims:
            print(f"   - {claim['properties']}")
        
        # Example 5: Get graph statistics
        print("\n5. Graph statistics...")
        stats = graph.get_graph_stats()
        print(f"   Total nodes: {stats['nodes']}")
        print(f"   Total relationships: {stats['relationships']}")
        
        # Example 6: DFS walk from a node
        print("\n6. Performing DFS walk...")
        if all_claims:
            # Get the first claim's ID
            start_node_id = all_claims[0]['id']
            print(f"   Starting DFS walk from node ID {start_node_id}")
            
            # Perform DFS walk following SUPPORTS relationships
            dfs_result = graph.dfs_walk(start_node_id, 'SUPPORTS')
            print(f"   Found {len(dfs_result)} nodes via DFS walk:")
            for node in dfs_result:
                print(f"   - Depth {node['depth']}: {node['labels'][0]} - {node['properties']}")
        
        print("\n" + "=" * 50)
        print("Example completed successfully!")
        print("=" * 50)
        print("\nYou can view the graph in Neo4j Browser at: http://localhost:7474")
        print("Run this query to see all nodes: MATCH (n) RETURN n")
        
    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("Make sure Neo4j is running: docker-compose up -d")
    
    finally:
        graph.close()


def example_simple_usage():
    """Simple example: Just create a few nodes"""
    graph = Neo4jGraph()
    
    try:
        # Create nodes
        node1 = graph.create_node('Person', {'name': 'Bob'})
        node2 = graph.create_node('Person', {'name': 'Charlie'})
        
        # Create relationship
        graph.create_relationship(
            'Person', 'name', 'Bob',
            'Person', 'name', 'Charlie',
            'KNOWS',
            {'since': '2020'}
        )
        
        print("Created simple graph with 2 people who know each other")
        
    finally:
        graph.close()


if __name__ == '__main__':
    # Run the full example
    example_create_graph()
    
    # Uncomment to run the simple example instead:
    # example_simple_usage()

