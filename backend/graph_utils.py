"""
Neo4j graph database utilities for creating graphs and managing nodes.
"""

from neo4j import GraphDatabase
import os
from typing import Dict, List, Optional, Any


class Neo4jGraph:
    """Neo4j graph database connection and operations"""
    
    def __init__(self, uri: str = None, user: str = None, password: str = None):
        """Initialize Neo4j connection"""
        self.uri = uri or os.getenv('NEO4J_URI', 'bolt://localhost:7687')
        self.user = user or os.getenv('NEO4J_USER', 'neo4j')
        self.password = password or os.getenv('NEO4J_PASSWORD', 'neo4j123')
        self.driver = GraphDatabase.driver(self.uri, auth=(self.user, self.password))
    
    def close(self):
        """Close the database connection"""
        self.driver.close()
    
    def create_node(self, label: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a single node with a label and properties.
        
        Args:
            label: Node label (e.g., 'Person', 'Document', 'Claim')
            properties: Dictionary of node properties
            
        Returns:
            Dictionary with node information
        """
        def _create_node(tx, label, props):
            query = f"CREATE (n:{label} $props) RETURN n"
            result = tx.run(query, props=props)
            return result.single()["n"]
        
        with self.driver.session() as session:
            node = session.execute_write(_create_node, label, properties)
            return {
                'id': node.id,
                'labels': list(node.labels),
                'properties': dict(node)
            }
    
    def create_nodes(self, nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Create multiple nodes at once.
        
        Args:
            nodes: List of dictionaries with 'label' and 'properties' keys
                  Example: [{'label': 'Person', 'properties': {'name': 'Alice'}}]
        
        Returns:
            List of created node information
        """
        created_nodes = []
        for node_data in nodes:
            created_nodes.append(self.create_node(
                node_data['label'],
                node_data['properties']
            ))
        return created_nodes
    
    def create_relationship(
        self,
        from_label: str,
        from_property: str,
        from_value: Any,
        to_label: str,
        to_property: str,
        to_value: Any,
        relationship_type: str,
        relationship_properties: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a relationship between two nodes.
        
        Args:
            from_label: Label of the source node
            from_property: Property name to match source node
            from_value: Property value to match source node
            to_label: Label of the target node
            to_property: Property name to match target node
            to_value: Property value to match target node
            relationship_type: Type of relationship (e.g., 'KNOWS', 'SUPPORTS', 'CONFLICTS')
            relationship_properties: Optional properties for the relationship
            
        Returns:
            Dictionary with relationship information
        """
        def _create_relationship(tx, from_label, from_prop, from_val, to_label, 
                                to_prop, to_val, rel_type, rel_props):
            query = f"""
            MATCH (a:{from_label} {{{from_prop}: $from_val}})
            MATCH (b:{to_label} {{{to_prop}: $to_val}})
            CREATE (a)-[r:{rel_type} $rel_props]->(b)
            RETURN r, a, b
            """
            result = tx.run(
                query,
                from_val=from_val,
                to_val=to_val,
                rel_props=rel_props or {}
            )
            record = result.single()
            return {
                'relationship': dict(record['r']),
                'from': {'id': record['a'].id, 'properties': dict(record['a'])},
                'to': {'id': record['b'].id, 'properties': dict(record['b'])}
            }
        
        with self.driver.session() as session:
            return session.execute_write(
                _create_relationship,
                from_label, from_property, from_value,
                to_label, to_property, to_value,
                relationship_type, relationship_properties
            )
    
    def get_node(self, label: str, property_name: str, property_value: Any) -> Optional[Dict[str, Any]]:
        """Get a node by label and property"""
        def _get_node(tx, label, prop_name, prop_value):
            query = f"MATCH (n:{label} {{{prop_name}: $value}}) RETURN n"
            result = tx.run(query, value=prop_value)
            record = result.single()
            return record["n"] if record else None
        
        with self.driver.session() as session:
            node = session.execute_read(_get_node, label, property_name, property_value)
            if node:
                return {
                    'id': node.id,
                    'labels': list(node.labels),
                    'properties': dict(node)
                }
            return None
    
    def get_node_by_id(self, node_id: int) -> Optional[Dict[str, Any]]:
        """Get a node by its internal Neo4j ID"""
        def _get_node_by_id(tx, n_id):
            query = "MATCH (n) WHERE id(n) = $node_id RETURN n"
            result = tx.run(query, node_id=n_id)
            record = result.single()
            return record["n"] if record else None
        
        with self.driver.session() as session:
            node = session.execute_read(_get_node_by_id, node_id)
            if node:
                return {
                    'id': node.id,
                    'labels': list(node.labels),
                    'properties': dict(node)
                }
            return None
    
    def get_all_nodes(self, label: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all nodes, optionally filtered by label"""
        def _get_all_nodes(tx, label):
            if label:
                query = f"MATCH (n:{label}) RETURN n"
            else:
                query = "MATCH (n) RETURN n"
            result = tx.run(query)
            return [record["n"] for record in result]
        
        with self.driver.session() as session:
            nodes = session.execute_read(_get_all_nodes, label)
            return [{
                'id': node.id,
                'labels': list(node.labels),
                'properties': dict(node)
            } for node in nodes]
    
    def delete_all(self):
        """Delete all nodes and relationships (use with caution!)"""
        def _delete_all(tx):
            tx.run("MATCH (n) DETACH DELETE n")
        
        with self.driver.session() as session:
            session.execute_write(_delete_all)

    def dfs_walk(self, node_id: int, connection_type: str, max_depth: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Perform a depth-first search walk starting from a node, following relationships
        of the specified type.
        
        Args:
            node_id: The internal Neo4j node ID to start from
            connection_type: The relationship type to follow (e.g., 'SUPPORTS', 'CONFLICTS')
            max_depth: Optional maximum depth to traverse (None = unlimited)
            
        Returns:
            List of nodes visited in DFS order, including the starting node
        """
        def _get_node_by_id(tx, n_id):
            """Get node by internal ID"""
            query = "MATCH (n) WHERE id(n) = $node_id RETURN n"
            result = tx.run(query, node_id=n_id)
            record = result.single()
            return record["n"] if record else None
        
        def _get_connected_nodes(tx, n_id, rel_type):
            """Get all nodes connected via the specified relationship type"""
            query = f"""
            MATCH (start)-[r:{rel_type}]->(connected)
            WHERE id(start) = $node_id
            RETURN id(connected) as node_id, connected as node
            """
            result = tx.run(query, node_id=n_id)
            return [(record["node_id"], record["node"]) for record in result]
        
        visited = set()
        result_nodes = []
        stack = [(node_id, 0)]  # (node_id, depth)
        
        with self.driver.session() as session:
            # Verify starting node exists
            start_node = session.execute_read(_get_node_by_id, node_id)
            if not start_node:
                return []
            
            while stack:
                current_id, depth = stack.pop()
                
                # Skip if already visited or max depth exceeded
                if current_id in visited:
                    continue
                if max_depth is not None and depth > max_depth:
                    continue
                
                # Mark as visited
                visited.add(current_id)
                
                # Get current node details
                current_node = session.execute_read(_get_node_by_id, current_id)
                if current_node:
                    result_nodes.append({
                        'id': current_node.id,
                        'labels': list(current_node.labels),
                        'properties': dict(current_node),
                        'depth': depth
                    })
                
                # Get connected nodes and add to stack (reverse order for DFS)
                connected = session.execute_read(_get_connected_nodes, current_id, connection_type)
                # Reverse to maintain DFS order (last added, first popped)
                for neighbor_id, neighbor_node in reversed(connected):
                    if neighbor_id not in visited:
                        stack.append((neighbor_id, depth + 1))
        
        return result_nodes
    
    def get_graph_stats(self) -> Dict[str, int]:
        """Get statistics about the graph"""
        def _get_stats(tx):
            node_count = tx.run("MATCH (n) RETURN count(n) as count").single()["count"]
            rel_count = tx.run("MATCH ()-[r]->() RETURN count(r) as count").single()["count"]
            return {'nodes': node_count, 'relationships': rel_count}
        
        with self.driver.session() as session:
            return session.execute_read(_get_stats)


# Convenience function for quick access
def get_graph() -> Neo4jGraph:
    """Get a Neo4j graph instance with default configuration"""
    return Neo4jGraph()


def get_conflict(claim: str) -> Dict[str, Any]:
    """
    Get conflicts related to a claim (example function).
    This is a placeholder - implement based on your specific needs.
    """
    graph = get_graph()
    try:
        # Example: Find nodes related to the claim
        node = graph.get_node('Claim', 'text', claim)
        if node:
            return {'conflict': node}
        return {'conflict': None}
    finally:
        graph.close()
