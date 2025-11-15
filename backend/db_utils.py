import psycopg2
import os
import anthropic
from graph_utils import Neo4jGraph
from typing import Dict, Any, List, Tuple, Optional
import json


TOP_K_CLAIM_MATCHES = 5


class DatabaseUtils:
    def __init__(self, graph: Neo4jGraph):
        """Initialize database connection"""
        self.db_config = {
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': os.getenv('DB_PORT', '5433'),
            'user': os.getenv('DB_USER', 'postgres'),
            'password': os.getenv('DB_PASSWORD', 'postgres'),
            'database': os.getenv('DB_NAME', 'ohmyclaude_db')
        }
        self.graph = graph

    def _get_connection(self):
        """Get a database connection"""
        return psycopg2.connect(**self.db_config)

    def create_document(self, description: str, content: str, title: str, schema: str = "Include any entity and relationship type", project_info: Dict[str, Any] = None) -> dict:
        """Create a new supporting document and populate the resource graph with claims/entities."""
        if project_info is None:
            project_info = {}
        result = None
        with self._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO supporting_documents (name) VALUES (%s) RETURNING id
                """, (title,))
                result = cursor.fetchone()[0]
                conn.commit()
        
        # parse content
        # break into chunks of 2000 characters
        chunks = [content[i:i+2000] for i in range(0, len(content), 2000)]
        # for each chunk, extract entities/relationships/claims
        if schema and project_info:
            print(f"Schema: {schema}")
            print(f"Project info: {project_info}")
        for idx, chunk in enumerate(chunks):
            chunk_start = idx * 2000
            print(f"Extracting entities and relationships from chunk: {chunk}")
            # extract entities and relationships
            entities, relationships, claims, claim_edges = self.extract_entities(chunk, schema, project_info)
            print(f"Entities: {entities}")
            print(f"Relationships: {relationships}")
            # Optionally deduplicate entities (not used directly for provenance)
            # deduplicated_entities = self.deduplicate_entities(entities)

            # Attach provenance to each resource-graph claim
            for claim in claims:
                claim["doc_type"] = "supporting"
                claim["doc_id"] = result
                claim["doc_title"] = title
                claim["chunk_index"] = idx
                claim["chunk_start"] = chunk_start
                claim["chunk_text"] = chunk

            # Add entities, relationships, and resource-graph claims to Neo4j
            self.add_entities(entities, relationships, claims, claim_edges)
        return result

    def create_main_document(self, title: str, desc: str, content: str, graph: Neo4jGraph, schema: str = "Return all claims and relationships", project_info: Dict[str, Any] = None, doc_id: str = None) -> None:
        """Create a main document"""
        chunks = [content[i:i+2000] for i in range(0, len(content), 2000)]
        if schema and project_info:
            for idx, chunk in enumerate(chunks):
                chunk_start = idx * 2000
                # extract claims and relationships between them
                print("Reached")
                claims, claim_edges = self.extract_claims(
                    chunk=chunk,
                    schema=schema,
                    project_info=project_info,
                    doc_id=doc_id or title,
                    chunk_index=idx,
                    total_chunks=len(chunks)
                )

                print(f"Claims: {claims}")
                # deduplicate propositions within this chunk
                deduplicated_claims = self.deduplicate_claims(claims)
                # Ensure provenance is present on deduplicated propositions
                for claim in deduplicated_claims:
                    claim["doc_type"] = "main"
                    claim["doc_id"] = doc_id or title
                    claim["doc_title"] = title
                    claim["chunk_index"] = idx
                    claim["chunk_start"] = chunk_start
                    claim["chunk_text"] = chunk
                # add propositions and their relationships to the graph
                self.add_claims(deduplicated_claims, claim_edges, graph, type="Proposition")

    def extract_entities(self, chunk: str, schema: str, project_info: dict) -> Tuple[List[Dict], List[Dict], List[Dict], List[Dict]]:
        """Extract entities, relationships, claims, and claim_edges from a chunk of content"""
        client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        response = client.beta.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4096,
            messages=[
                {
                    "role": "user", "content": f"""<task>
                    <goal>
                        Using the provided document-local schema, extract all entity mentions
                        and relationship instances present in this text chunk. Then, generate claims that are based on the entities and relationships generated. 
                    </goal>

                    <document_schema>
                        <!-- This is the DOCUMENT-LOCAL schema (global + any resource-specific extensions),
                            as JSON for context. You MUST ONLY use these entity_types and relationship_types
                            when labeling extractions. Do NOT invent new types here. -->
                        <![CDATA[
                    {schema}
                        ]]>
                    </document_schema>

                    <chunk_metadata>
                        <chunk_text>
                    {chunk}
                        </chunk_text>
                    </chunk_metadata>

                    <guidelines>
                        <entities>
                        - Identify mentions of entities in this chunk that correspond to the
                            entity_types defined in the document-local schema.
                        - For each entity mention you extract:
                            * Assign exactly one entity_type.id from the schema.
                            * Provide the surface text span as it appears in the chunk.
                            * Optionally provide a short normalized_name if helpful (e.g. "ImageNet", "ResNet-50").
                        - Do NOT invent new entity types; if no suitable type exists for a mention,
                            omit that mention.
                        - Do NOT merge or deduplicate entities across chunks; treat this chunk in isolation.
                            (Global deduplication will be handled by a separate step.)
                        </entities>

                        <relationships>
                        - Extract relationship instances only when they can be grounded in:
                            * entity mentions you have extracted in this chunk, and
                            * relationship_types defined in the document-local schema.
                        - For each relationship:
                            * Use one relationship_types.id from the schema.
                            * Reference the source and target entities using the local entity identifiers
                            you assign in this chunk.
                            * Only include relationships that are explicitly supported by the text in this chunk.
                        - Do NOT invent new relationship types, and do NOT infer relationships that are
                            not clearly stated or strongly implied in the chunk.
                        </relationships>

                        <claims>
                        - A "claim" is an atomic statement in the text that could be true or false,
                            typically a sentence or clause asserting something about entities
                            defined in the schema (e.g. a model, dataset, metric, result, theorem).
                        - For each claim you extract, you MUST:
                            * Assign a unique local claim id for this chunk (e.g. "c1", "c2", ...).
                            * Include the exact text span of the claim as it appears in the chunk.
                            * Provide a structured representation using the schema:
                            - Reference entities as "fungible" schema-based roles, such as
                                "Dataset:imagenet", "Model:our_model", etc., not raw strings only.
                            - Include the main predicate / relation (e.g. performance, comparison,
                                causal effect) and any key qualifiers (dataset, metric, condition,
                                time, assumption) as fields defined in the JSON schema.
                        - Only extract claims that are actually present in the chunk; do NOT infer
                            additional claims not clearly stated.
                        </claims>

                        <claim_relations>
                        - Consider only relations between claims that appear in THIS chunk.
                            Cross-chunk connections will be handled separately.
                        - Add a directed "implies" relation when one claim clearly entails another
                            in the context of the text (e.g. "therefore", "thus", "as a consequence").
                        - Add a "contradicts" relation when two claims clearly cannot both be true
                            under the same conditions (e.g. conflicting numbers, opposite statements
                            about the same entities/context).
                        - If the relation is ambiguous or weak, do NOT create an edge. Be conservative.
                        - Each relation you output must:
                            * Reference the source and target claim ids you assigned.
                            * Use an allowed relation type from the JSON schema (e.g. "implies",
                            "contradicts").
                        </claim_relations>

                        <constraints>
                        - Work ONLY with the information in this chunk and the given schema.
                            Do NOT use outside knowledge about the document or domain.
                        - If the chunk does not contain any valid entities or relationships under
                            the schema, return empty lists.
                        - Be conservative: prefer missing an uncertain extraction over hallucinating.
                        </constraints>
                    </guidelines>

                    </task>

                    <output_format>
                    You MUST return your response as valid JSON only, with this exact structure:
                    {{
                        "entities": [
                            {{
                                "id": "e1",
                                "type_id": "entity_type_from_schema",
                                "surface": "exact text from chunk",
                                "normalized": "optional normalized name",
                                "char_start": 0,
                                "char_end": 10
                            }}
                        ],
                        "relationships": [
                            {{
                                "id": "r1",
                                "type_id": "relationship_type_from_schema",
                                "source_entity_id": "e1",
                                "target_entity_id": "e2",
                                "evidence": "optional evidence text",
                                "char_start": 0,
                                "char_end": 20
                            }}
                        ],
                        "claims": [
                            {{
                                "id": "c1",
                                "text": "exact claim text from chunk",
                                "relation_id": "relation_type_from_schema",
                                "entities": [
                                    {{
                                        "role": "subject",
                                        "label": "EntityType:identifier"
                                    }}
                                ],
                                "qualifiers": {{}}
                            }}
                        ],
                        "claim_edges": [
                            {{
                                "source_claim_id": "c1",
                                "target_claim_id": "c2",
                                "relation_type": "implies"
                            }}
                        ]
                    }}
                    
                    Return ONLY the JSON object, no other text or explanation.
                    """
                }]
        )
        # Parse the response - handle markdown code blocks if present
        import re
        try:
            text = response.content[0].text.strip()
            
            # Remove markdown code block markers if present
            # Handle both ```json and ``` formats
            text = re.sub(r'^```(?:json)?\s*\n', '', text, flags=re.MULTILINE)
            text = re.sub(r'\n```\s*$', '', text, flags=re.MULTILINE)
            text = text.strip()
            
            # Try to find JSON object in the text (in case there's extra text)
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                text = json_match.group(0)
            
            result = json.loads(text)
            return result.get('entities', []), result.get('relationships', []), result.get('claims', []), result.get('claim_edges', [])
        except json.JSONDecodeError as e:
            # Fallback if response is not valid JSON
            print(f"JSON parsing error: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")  # Print first 500 chars
            return [], [], [], []
        except Exception as e:
            print(f"Unexpected error parsing response: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return [], [], [], []

    def deduplicate_entities(self, entities: list, project_info: dict = None) -> list:
        """Deduplicate entities by grouping them by type_id and normalized name, then merging similar entities"""
        if not entities:
            return []
        
        # Group entities by their type_id and normalized name (primary key)
        def get_entity_key(entity):
            """Generate a key for grouping entities: type_id + normalized name"""
            type_id = entity.get('type_id', '')
            # Use normalized name if available, otherwise use surface text
            normalized = entity.get('normalized', '') or entity.get('surface', '')
            return (type_id, normalized.lower().strip())
        
        # Group entities by their key
        entity_groups = {}
        for entity in entities:
            key = get_entity_key(entity)
            if key not in entity_groups:
                entity_groups[key] = []
            entity_groups[key].append(entity)
        
        # Deduplicate each group
        client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        deduplicated_entities = []
        
        for key, entity_bucket in entity_groups.items():
            # If only one entity in the bucket, no need to deduplicate
            if len(entity_bucket) == 1:
                deduplicated_entities.append(entity_bucket[0])
                continue
            
            # Use LLM to deduplicate entities in this bucket
            try:
                bucket_json = json.dumps(entity_bucket, indent=2)
                prompt = f"""<task>
  <goal>
    Given a group of similar entities that share the same primary key
    (same type_id and normalized name), merge redundant entities into one
    or more cleaned-up entity instances.
  </goal>

  <entity_bucket>
    <!--
      JSON array of entity objects that all share the same primary key.
      Each entity has the SAME (type_id, normalized_name) key.
      Typical fields per entity:
        - "id":        entity id (e.g. "e_17")
        - "type_id":   entity type from schema (e.g. "PERSON", "DISEASE")
        - "surface":   exact text span as it appears in the document
        - "normalized": normalized name (e.g. "ImageNet", "ResNet-50")
        - "char_start": optional character offset of the start
        - "char_end": optional character offset of the end
    -->
    <![CDATA[
{bucket_json}
    ]]>
  </entity_bucket>

  <guidelines>
    - All input entities in this bucket have the same primary key
      (same type_id and same normalized name), but may differ
      in surface text, character positions, or minor details.
    - Your job is to:
      * Identify entities that are effectively referring to the SAME
        real-world entity, and merge them.
      * For each merge, produce a single new entity object that combines
        their information (like a union), while removing redundancy.
    - Be conservative:
      * If an entity appears to refer to a genuinely different instance
        that cannot be safely merged, you may leave it out of any merge
        and it will remain as-is.
      * It is acceptable for some entities to remain unmerged.

    - When creating a merged entity:
      * Choose an id that is one of the source entity ids.
      * Keep the same type_id as the bucket.
      * Use the normalized name as the primary identifier.
      * Combine surface texts if they differ (or use the most representative one).
      * Merge character positions to cover the full span if needed.
  </guidelines>

</task>

<output_format>
You MUST return your response as valid JSON only, with this exact structure:
{{
  "merges": [
    {{
      "source_ids": ["e1", "e2"],
      "merged_entity": {{
        "id": "e1",
        "type_id": "entity_type",
        "surface": "representative surface text",
        "normalized": "normalized_name",
        "char_start": 0,
        "char_end": 10
      }}
    }}
  ],
  "unmerged": [
    {{
      "id": "e3",
      "type_id": "entity_type",
      "surface": "surface text",
      "normalized": "normalized_name",
      "char_start": 0,
      "char_end": 10
    }}
  ]
}}

Return ONLY the JSON object, no other text or explanation.
</output_format>"""
                
                response = client.messages.create(
                    model="claude-sonnet-4-5-20250929",
                    max_tokens=4096,
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )
                
                # Parse response
                import re
                text = response.content[0].text.strip()
                # Remove markdown code blocks if present
                text = re.sub(r'^```(?:json)?\s*\n', '', text, flags=re.MULTILINE)
                text = re.sub(r'\n```\s*$', '', text, flags=re.MULTILINE)
                text = text.strip()
                
                # Extract JSON
                json_match = re.search(r'\{.*\}', text, re.DOTALL)
                if json_match:
                    text = json_match.group(0)
                
                result = json.loads(text)
                
                # Add merged entities
                for merge in result.get('merges', []):
                    deduplicated_entities.append(merge['merged_entity'])
                
                # Add unmerged entities
                deduplicated_entities.extend(result.get('unmerged', []))
                
            except Exception as e:
                print(f"Error deduplicating entity bucket: {e}")
                # If deduplication fails, keep all original entities
                deduplicated_entities.extend(entity_bucket)
        
        return deduplicated_entities

    def extract_claims(self, chunk: str, schema: str, project_info: dict, doc_id: str = "unknown", chunk_index: int = 0, total_chunks: int = 1) -> Tuple[List[Dict], List[Dict]]:
        """Extract claims and claim relationships from a chunk of content"""
        client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        
        # Format schema as JSON string if it's a dict
        schema_json = schema if isinstance(schema, str) else json.dumps(schema)
        
        prompt = f"""<task>

  <goal>
    Using the provided document-local schema, extract all claims in this text chunk
    and any explicit logical relations (implies / contradicts) between those claims.
  </goal>

  <document_schema>
    <!-- Global + document-local schema (domain entity types, relationship types, claim schema),
         provided as JSON for context. Do NOT invent new types. -->
    <![CDATA[
{schema_json}
    ]]>
  </document_schema>

  <chunk_metadata>
    <doc_id>{doc_id}</doc_id>
    <chunk_index>{chunk_index}</chunk_index>
    <total_chunks>{total_chunks}</total_chunks>
  </chunk_metadata>

  <chunk_text>
{chunk}
  </chunk_text>

  <guidelines>
    <claims>
      - A "claim" is an atomic statement in the text that could be true or false,
        typically a sentence or clause asserting something about entities
        defined in the schema (e.g. a model, dataset, metric, result, theorem).
      - For each claim you extract, you MUST:
        * Assign a unique local claim id for this chunk (e.g. "c1", "c2", ...).
        * Include the exact text span of the claim as it appears in the chunk.
        * Provide a structured representation using the schema:
          - Reference entities as "fungible" schema-based roles, such as
            "Dataset:imagenet", "Model:our_model", etc., not raw strings only.
          - Include the main predicate / relation (e.g. performance, comparison,
            causal effect) and any key qualifiers (dataset, metric, condition,
            time, assumption) as fields defined in the JSON schema.
      - Only extract claims that are actually present in the chunk; do NOT infer
        additional claims not clearly stated.
    </claims>

    <claim_relations>
      - Consider only relations between claims that appear in THIS chunk.
        Cross-chunk connections will be handled separately.
      - Add a directed "implies" relation when one claim clearly entails another
        in the context of the text (e.g. "therefore", "thus", "as a consequence").
      - Add a "contradicts" relation when two claims clearly cannot both be true
        under the same conditions (e.g. conflicting numbers, opposite statements
        about the same entities/context).
      - If the relation is ambiguous or weak, do NOT create an edge. Be conservative.
      - Each relation you output must:
        * Reference the source and target claim ids you assigned.
        * Use an allowed relation type from the JSON schema (e.g. "implies",
          "contradicts").
    </claim_relations>

    <constraints>
      - Work ONLY with the information in this chunk and the supplied schema.
        Do NOT use external world knowledge beyond what is implied in the text.
      - Do NOT invent new entity types, relation types, or claim fields; instead,
        populate only the fields defined in the JSON schema provided by the caller.
      - If the chunk contains no valid claims under this definition, return empty
        lists for claims and claim relations.
      - Prefer missing a borderline claim or edge over hallucinating one.
    </constraints>
  </guidelines>

</task>

<output_format>
You MUST return your response as valid JSON only, with this exact structure:
{{
  "claims": [
    {{
      "id": "c1",
      "text": "exact claim text from chunk",
      "relation_id": "relation_type_from_schema",
      "entities": [
        {{
          "role": "subject",
          "label": "EntityType:identifier"
        }}
      ],
      "qualifiers": {{}}
    }}
  ],
  "claim_edges": [
    {{
      "source_claim_id": "c1",
      "target_claim_id": "c2",
      "relation_type": "implies"
    }}
  ]
}}

Return ONLY the JSON object, no other text or explanation.
</output_format>"""
        
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4096,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        # Parse the response - handle markdown code blocks if present
        import re
        try:
            text = response.content[0].text.strip()
            
            # Remove markdown code block markers if present
            text = re.sub(r'^```(?:json)?\s*\n', '', text, flags=re.MULTILINE)
            text = re.sub(r'\n```\s*$', '', text, flags=re.MULTILINE)
            text = text.strip()
            
            # Try to find JSON object in the text (in case there's extra text)
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                text = json_match.group(0)
            
            result = json.loads(text)
            return result.get('claims', []), result.get('claim_edges', [])
        except json.JSONDecodeError as e:
            print(f"JSON parsing error in extract_claims: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return [], []
        except Exception as e:
            print(f"Unexpected error parsing claims response: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return [], []

    def deduplicate_claims(self, claims: list) -> list:
        """Deduplicate claims by grouping them by entity labels, then merging similar claims"""
        if not claims:
            return []
        
        # Group claims by their entity labels (primary key: relation_id + sorted entity labels)
        def get_claim_key(claim):
            """Generate a key for grouping claims: relation_id + sorted entity labels"""
            relation_id = claim.get('relation_id', '')
            entities = claim.get('entities', [])
            # Extract and sort entity labels
            entity_labels = sorted([entity.get('label', '') for entity in entities if entity.get('label')])
            return (relation_id, tuple(entity_labels))
        
        # Group claims by their key
        claim_groups = {}
        for claim in claims:
            key = get_claim_key(claim)
            if key not in claim_groups:
                claim_groups[key] = []
            claim_groups[key].append(claim)
        
        # Deduplicate each group
        client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        deduplicated_claims = []
        
        for key, claim_bucket in claim_groups.items():
            # If only one claim in the bucket, no need to deduplicate
            if len(claim_bucket) == 1:
                deduplicated_claims.append(claim_bucket[0])
                continue
            
            # Use LLM to deduplicate claims in this bucket
            try:
                bucket_json = json.dumps(claim_bucket, indent=2)
                prompt = f"""<task>
  <goal>
    Given a group of similar claims that share the same primary key
    (same relation and entity labels), merge redundant claims into one
    or more cleaned-up claim instances.
  </goal>

  <claim_bucket>
    <!--
      JSON array of claim objects that all share the same primary key.
      Each claim has the SAME (relation_id, sorted entity labels) key.
      Typical fields per claim:
        - "id":        claim id (e.g. "c_17")
        - "text":      claim text as it appears in the document
        - "relation_id": predicate label (e.g. "achieves_metric")
        - "entities":  array of {{ "role"?, "label" }} where label is
                       a fungible schema-based label like "Dataset:imagenet"
        - "qualifiers": optional object with extra structured info
                       (e.g. metric values, conditions, time)
    -->
    <![CDATA[
{bucket_json}
    ]]>
  </claim_bucket>

  <guidelines>
    - All input claims in this bucket have the same primary key
      (same relation_id and same set of entity labels), but may differ
      in wording, qualifiers, or minor details.
    - Your job is to:
      * Identify claims that are effectively saying the SAME fact under
        the SAME conditions, and merge them.
      * For each merge, produce a single new claim object that combines
        their information (like a union), while removing redundancy.
    - Be conservative:
      * If a claim appears to add a genuinely different condition, scope,
        or value that cannot be safely merged, you may leave it out of
        any merge and it will remain as-is.
      * It is acceptable for some claims to remain unmerged.

    - When creating a merged claim:
      * Choose an id that is one of the source claim ids.
      * Rewrite a clear, concise "text" for the claim that best captures
        the shared fact.
      * Keep the same relation_id as the bucket (unless there is a clear
        and necessary normalization).
      * Build "entities" so they are consistent with the bucket's primary
        key (same entity labels, optional roles).
      * Merge "qualifiers" by combining compatible fields from the
        source claims (e.g. unify metric values, conditions, notes),
        omitting conflicting or unclear details.
  </guidelines>

</task>

<output_format>
You MUST return your response as valid JSON only, with this exact structure:
{{
  "merges": [
    {{
      "source_ids": ["c1", "c2"],
      "merged_claim": {{
        "id": "c1",
        "text": "merged claim text",
        "relation_id": "relation_type",
        "entities": [{{"label": "EntityType:identifier"}}],
        "qualifiers": {{}}
      }}
    }}
  ],
  "unmerged": [
    {{
      "id": "c3",
      "text": "claim text",
      "relation_id": "relation_type",
      "entities": [{{"label": "EntityType:identifier"}}],
      "qualifiers": {{}}
    }}
  ]
}}

Return ONLY the JSON object, no other text or explanation.
</output_format>"""
                
                response = client.messages.create(
                    model="claude-sonnet-4-5-20250929",
                    max_tokens=4096,
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )
                
                # Parse response
                import re
                text = response.content[0].text.strip()
                # Remove markdown code blocks if present
                text = re.sub(r'^```(?:json)?\s*\n', '', text, flags=re.MULTILINE)
                text = re.sub(r'\n```\s*$', '', text, flags=re.MULTILINE)
                text = text.strip()
                
                # Extract JSON
                json_match = re.search(r'\{.*\}', text, re.DOTALL)
                if json_match:
                    text = json_match.group(0)
                
                result = json.loads(text)
                
                # Add merged claims
                for merge in result.get('merges', []):
                    deduplicated_claims.append(merge['merged_claim'])
                
                # Add unmerged claims
                deduplicated_claims.extend(result.get('unmerged', []))
                
            except Exception as e:
                print(f"Error deduplicating claim bucket: {e}")
                # If deduplication fails, keep all original claims
                deduplicated_claims.extend(claim_bucket)
        
        return deduplicated_claims

    def add_entities(self, entities: list, relationships: list, claims: list = None, claim_edges: list = None) -> None:
        # Create a mapping from entity local IDs to entity data
        entity_map = {}
        
        # First, create all entities and store their local IDs
        for entity in entities:
            # Flatten nested objects to JSON strings for Neo4j compatibility
            flattened_entity = self._flatten_properties_for_neo4j(entity)
            # Create the node in Neo4j
            node = self.graph.create_node(label="Entity", properties=flattened_entity)
            # Store mapping from local ID to entity data (for relationship creation)
            if 'id' in entity:
                entity_map[entity['id']] = {
                    'node_id': node['id'],
                    'properties': entity,
                    'surface': entity.get('surface', ''),
                    'normalized': entity.get('normalized', entity.get('surface', ''))
                }
        
        # Add claims if provided
        if claims and claim_edges:
            self.add_claims(claims, claim_edges, self.graph, type="Claim")
        
        # Now create relationships using the entity mapping
        for relationship in relationships:
            # Handle both old format and new format
            if 'source_entity_id' in relationship and 'target_entity_id' in relationship:
                # New format: uses local entity IDs
                source_id = relationship['source_entity_id']
                target_id = relationship['target_entity_id']
                relationship_type = relationship.get('type_id', 'RELATED_TO')
                
                # Look up the entities
                if source_id in entity_map and target_id in entity_map:
                    source_entity = entity_map[source_id]
                    target_entity = entity_map[target_id]
                    
                    # Use normalized name or surface text as the matching property
                    source_value = source_entity['normalized'] or source_entity['surface']
                    target_value = target_entity['normalized'] or target_entity['surface']
                    
                    try:
                        self.graph.create_relationship(
                            from_label='Entity',
                            from_property='normalized',
                            from_value=source_value,
                            to_label='Entity',
                            to_property='normalized',
                            to_value=target_value,
                            relationship_type=relationship_type,
                            relationship_properties={
                                'evidence': relationship.get('evidence', ''),
                                'char_start': relationship.get('char_start'),
                                'char_end': relationship.get('char_end')
                            }
                        )
                    except Exception as e:
                        print(f"Error creating relationship: {e}")
                        print(f"Source: {source_value}, Target: {target_value}, Type: {relationship_type}")
                else:
                    print(f"Warning: Could not find entities for relationship {relationship.get('id', 'unknown')}")
                    print(f"Source ID: {source_id}, Target ID: {target_id}")
                    print(f"Available entity IDs: {list(entity_map.keys())}")
            else:
                # Old format: direct property access
                try:
                    self.graph.create_relationship(
                                from_label=relationship.get('from_label', 'Entity'),
                                from_property=relationship.get('from_property', 'id'),
                                from_value=relationship.get('from_value'),
                                to_label=relationship.get('to_label', 'Entity'),
                                to_property=relationship.get('to_property', 'id'),
                                to_value=relationship.get('to_value'),
                                relationship_type=relationship.get('relationship_type', 'RELATED_TO'),
                            )
                except Exception as e:
                    print(f"Error creating relationship (old format): {e}")
        
        return None

    def get_top_resource_claim_matches(self, main_proposition: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Given a main-document claim, retrieve the most relevant resource claims
        from the graph using a simple overlap-based scoring heuristic.

        Scoring heuristic:
        - +1 if the relationship type (relation_id) is shared
        - +1 for each shared entity label (exact match on the 'label' field)

        The function returns up to TOP_K_CLAIM_MATCHES highest-scoring resource claims.
        """
        import json

        # Extract canonical features from the main-document proposition
        main_relation_id = main_proposition.get("relation_id")
        main_entities = {
            entity.get("label")
            for entity in main_proposition.get("entities", [])
            if isinstance(entity, dict) and entity.get("label")
        }
        main_text = main_proposition.get("text")

        # Fetch all Claim nodes from the graph (treated as resource claims for now)
        claim_nodes = self.graph.get_all_nodes(label="Claim")

        candidates: List[Dict[str, Any]] = []

        for node in claim_nodes:
            properties = node.get("properties", {})

            # Optionally skip claims that appear to be the same as the main claim
            if properties.get("text") == main_text:
                continue

            # Decode entities stored on the Claim node (may be JSON-encoded)
            raw_entities = properties.get("entities")
            entities_list: List[Dict[str, Any]] = []

            if isinstance(raw_entities, str):
                try:
                    decoded = json.loads(raw_entities)
                    if isinstance(decoded, list):
                        entities_list = decoded
                except Exception:
                    entities_list = []
            elif isinstance(raw_entities, list):
                entities_list = raw_entities

            node_entities = {
                entity.get("label")
                for entity in entities_list
                if isinstance(entity, dict) and entity.get("label")
            }

            # Compute score based on overlapping relation_id and entity labels
            score = 0

            if main_relation_id and properties.get("relation_id") == main_relation_id:
                score += 1

            shared_entities = main_entities.intersection(node_entities)
            score += len(shared_entities)

            # Only keep claims that share at least one entity or the relationship type
            if score <= 0:
                continue

            candidates.append(
                {
                    "node_id": node.get("id"),
                    "score": score,
                    "shared_entities": list(shared_entities),
                    "shared_relation": bool(
                        main_relation_id and properties.get("relation_id") == main_relation_id
                    ),
                    "claim": properties,
                }
            )

        # Sort by score descending and return top-k matches
        candidates.sort(key=lambda c: c["score"], reverse=True)
        return candidates[:TOP_K_CLAIM_MATCHES]

    def get_contradicting_resource_claims(
        self,
        main_claim: Dict[str, Any],
        resource_claims: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Given a main-document claim and a list of candidate resource claims,
        use an LLM to identify which resource claims clearly contradict
        the main claim.

        Returns a list of objects with at least:
            - resource_claim_id: str
            - reason: Optional[str]
        following the provided JSON schema.
        """
        import json
        import anthropic
        import os
        import re

        if not resource_claims:
            return []

        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

        main_claim_json = json.dumps(main_claim, ensure_ascii=False)
        resource_claims_json = json.dumps(resource_claims, ensure_ascii=False)

        prompt = f"""<task>
  <goal>
    Given one main-document claim and a set of similar resource claims,
    identify which resource claims clearly contradict the main claim.
    Ignore claims that merely support, are neutral, or are unclear.
  </goal>

  <main_claim>
    <![CDATA[
{main_claim_json}
    ]]>
  </main_claim>

  <resource_claims>
    <![CDATA[
{resource_claims_json}
    ]]>
  </resource_claims>

  <guidelines>
    - Work only with the information in the main claim and the provided
      resource claims. Do NOT assume external facts.
    - Mark a resource claim as CONTRADICTING the main claim only if,
      under reasonably similar conditions, they cannot both be true.
      Typical signs of contradiction include:
        * Opposite assertions about the same quantity or relationship.
        * Clearly incompatible numeric values (e.g. one says 85%,
          another says 60% for the same model/dataset/metric setup).
        * Mutually exclusive outcomes asserted under similar conditions.
    - If differences in conditions (dataset split, metric definition,
      experimental setup, assumptions) might explain the discrepancy,
      and it is not clearly a direct conflict, treat it as NOT a clear
      contradiction and do not mark it.
    - Be conservative: only flag strong, clear contradictions. It is
      better to miss a borderline case than to label a non-contradiction
      as a contradiction.
  </guidelines>

  <output_instructions>
    - Use the JSON schema provided by the caller to:
      * Return a list of resource claim ids that clearly contradict the
        main claim.
      * Optionally include a short explanation for each contradiction,
        referencing the main claim and the specific resource claim.
    - You do NOT need to produce any output entries for resource claims
      that do not contradict the main claim; they are treated as neutral,
      supportive, or unclear by default.
    - Do NOT output any free-form text outside of the JSON fields.
  </output_instructions>
</task>

<output_format>
You MUST return your response as valid JSON only, with this exact structure:
{{
  "type": "json_schema",
  "schema": {{
    "type": "object",
    "properties": {{
      "contradictions": {{
        "type": "array",
        "description": "Resource claims that clearly contradict the main claim.",
        "items": {{
          "type": "object",
          "properties": {{
            "resource_claim_id": {{
              "type": "string",
              "description": "The id of a resource claim that clearly contradicts the main claim."
            }},
            "reason": {{
              "type": "string",
              "description": "Optional short explanation of why this resource claim contradicts the main claim."
            }}
          }},
          "required": ["resource_claim_id"],
          "additionalProperties": false
        }}
      }}
    }},
    "required": ["contradictions"],
    "additionalProperties": false
  }}
}}

Return ONLY the JSON object, no other text or explanation.
</output_format>"""

        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            text = response.content[0].text.strip()

            # Remove markdown code block markers if present
            text = re.sub(r"^```(?:json)?\s*\n", "", text, flags=re.MULTILINE)
            text = re.sub(r"\n```\s*$", "", text, flags=re.MULTILINE)
            text = text.strip()

            # Try to find JSON object in the text (in case there's extra text)
            json_match = re.search(r"\{.*\}", text, re.DOTALL)
            if json_match:
                text = json_match.group(0)

            result = json.loads(text)
            contradictions = result.get("contradictions", [])
            if isinstance(contradictions, list):
                return contradictions
            return []
        except json.JSONDecodeError as e:
            print(f"JSON parsing error in get_contradicting_resource_claims: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return []
        except Exception as e:
            print(f"Unexpected error parsing contradictions response: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return []

    def assess_claim_with_graph_text(self, main_claim: Dict[str, Any]) -> Dict[str, Any]:
        """
        Fallback: export the resource graph as text, treat each line as
        an evidence snippet, and ask the LLM which snippets clearly
        contradict the main claim.
        """
        import json
        import re

        graph_text = ""
        try:
            graph_text = self.graph.export_graph_as_text(
                include_claims=True,
                include_relationship_facts=True,
                rel_type_filter=None,
            )
        except Exception as e:
            print(f"Error exporting graph as text: {e}")
            return {"contradictions": []}

        if not graph_text:
            return {"contradictions": []}

        # Build evidence snippets from the graph text (one line per snippet)
        evidence_items = []
        for idx, line in enumerate(graph_text.splitlines()):
            line = line.strip()
            if not line:
                continue
            evidence_items.append(
                {
                    "id": f"evidence_{idx}",
                    "text": line,
                    "provenance": "graph_export",
                }
            )

        if not evidence_items:
            return {"contradictions": []}

        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

        main_claim_json = json.dumps(main_claim, ensure_ascii=False)
        evidence_items_json = json.dumps(evidence_items, ensure_ascii=False)

        prompt = f"""<task>
  <goal>
    Given one contested claim and a set of textual evidence snippets
    retrieved from the resource graph, identify which snippets clearly
    contradict the claim. Ignore snippets that merely support, are
    neutral, or are unclear.
  </goal>

  <main_claim>
    <![CDATA[
{main_claim_json}
    ]]>
  </main_claim>

  <evidence_items>
    <![CDATA[
{evidence_items_json}
    ]]>
  </evidence_items>

  <guidelines>
    - Work only with the information in the main claim and the provided
      evidence snippets. Do NOT assume external facts.
    - Mark an evidence snippet as CONTRADICTING the main claim only if,
      taking the snippet at face value and under reasonably similar
      conditions, the snippet and the claim cannot both be true.
      Typical signs of contradiction include:
        * Opposite assertions about the same quantity or relationship.
        * Clearly incompatible numeric values for the same model/dataset/
          metric setup (e.g. one says 85% accuracy, another says 60%).
        * Mutually exclusive outcomes asserted under similar conditions.
    - If differences in conditions (dataset split, metric definition,
      experimental setup, assumptions) could reasonably explain the
      discrepancy, and it is not clearly a direct conflict, treat it as
      NOT a clear contradiction and do not mark it.
    - Be conservative: only flag strong, clear contradictions. It is
      better to miss a borderline case than to label a non-contradiction
      as a contradiction.
  </guidelines>

  <output_instructions>
    - Use the JSON schema provided by the caller to:
      * Return a list of evidence item ids that clearly contradict the
        main claim.
      * Optionally include a short explanation for each contradiction,
        referencing the main claim and the specific evidence id.
    - You do NOT need to produce any output entries for evidence items
      that do not contradict the main claim; they are treated as neutral,
      supportive, or unclear by default.
    - Do NOT output any free-form text outside of the JSON fields.
  </output_instructions>
</task>


<output_format>
You MUST return your response as valid JSON only, with this exact structure:
{{
  "type": "json_schema",
  "schema": {{
    "type": "object",
    "properties": {{
      "contradictions": {{
        "type": "array",
        "description": "Evidence snippets that clearly contradict the main claim.",
        "items": {{
          "type": "object",
          "properties": {{
            "evidence_id": {{
              "type": "string",
              "description": "The id of an evidence snippet that clearly contradicts the main claim."
            }},
            "reason": {{
              "type": "string",
              "description": "Optional short explanation of why this evidence contradicts the main claim."
            }}
          }},
          "required": ["evidence_id"],
          "additionalProperties": false
        }}
      }}
    }},
    "required": ["contradictions"],
    "additionalProperties": false
  }}
}}

Return ONLY the JSON object, no other text or explanation.
</output_format>"""

        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            text = response.content[0].text.strip()

            # Remove markdown code block markers if present
            text = re.sub(r"^```(?:json)?\s*\n", "", text, flags=re.MULTILINE)
            text = re.sub(r"\n```\s*$", "", text, flags=re.MULTILINE)
            text = text.strip()

            # Try to find JSON object in the text (in case there's extra text)
            json_match = re.search(r"\{.*\}", text, re.DOTALL)
            if json_match:
                text = json_match.group(0)

            result = json.loads(text)
            raw_contradictions = result.get("contradictions", [])
            if not isinstance(raw_contradictions, list):
                return {"contradictions": []}

            # Join back to evidence text for provenance
            evidence_by_id = {e["id"]: e for e in evidence_items}
            enriched = []
            for item in raw_contradictions:
                eid = item.get("evidence_id")
                if not eid:
                    continue
                ev = evidence_by_id.get(eid)
                if not ev:
                    continue
                enriched.append(
                    {
                        "evidence_id": eid,
                        "evidence_text": ev.get("text", ""),
                        "reason": item.get("reason", ""),
                    }
                )
            return {"contradictions": enriched}
        except json.JSONDecodeError as e:
            print(f"JSON parsing error in assess_claim_with_graph_text: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return {"contradictions": []}
        except Exception as e:
            print(f"Unexpected error parsing graph-text assessment response: {e}")
            print(f"Response text: {response.content[0].text[:500]}...")
            return {"contradictions": []}

    def analyze_main_document_contradictions(self) -> List[Dict[str, Any]]:
        """
        Analyze all main-document propositions in the graph for potential contradictions.

        For each Proposition node in the graph:
          1) Find top-k overlapping resource claims (Claim nodes).
          2) Ask the LLM which of those claims clearly contradict the proposition.
          3) If no contradictions are found, fall back to assessing the proposition
             against the full text export of the resource graph.

        Returns a list of per-proposition analysis results, including provenance
        (document and chunk information) for both the proposition and the
        contradicting resource claims/evidence.
        """
        results: List[Dict[str, Any]] = []

        # Main-document statements are stored as nodes with label "Proposition"
        proposition_nodes = self.graph.get_all_nodes(label="Proposition")

        for node in proposition_nodes:
            props = node.get("properties", {})

            # Reconstruct a proposition structure compatible with our LLM prompts
            main_proposition: Dict[str, Any] = {
                "id": str(node.get("id")),
                "text": props.get("text", ""),
                "relation_id": props.get("relation_id"),
                "entities": [],
                "qualifiers": props.get("qualifiers"),
                "doc_type": props.get("doc_type"),
                "doc_id": props.get("doc_id"),
                "doc_title": props.get("doc_title"),
                "chunk_index": props.get("chunk_index"),
                "chunk_start": props.get("chunk_start"),
                "chunk_text": props.get("chunk_text"),
                "node_id": node.get("id"),
            }

            # Decode entities if present on the proposition
            raw_entities = props.get("entities")
            if isinstance(raw_entities, str):
                try:
                    decoded = json.loads(raw_entities)
                    if isinstance(decoded, list):
                        main_proposition["entities"] = decoded
                except Exception:
                    main_proposition["entities"] = []
            elif isinstance(raw_entities, list):
                main_proposition["entities"] = raw_entities

            # 1) Top-k resource claim matches (Claim nodes)
            top_matches = self.get_top_resource_claim_matches(main_proposition)

            # Prepare resource claims in the expected shape for the LLM
            resource_claims_for_llm: List[Dict[str, Any]] = []
            for candidate in top_matches:
                claim_props = candidate.get("claim", {})

                # Decode entities on the candidate claim
                candidate_entities: List[Dict[str, Any]] = []
                c_raw_entities = claim_props.get("entities")
                if isinstance(c_raw_entities, str):
                    try:
                        decoded = json.loads(c_raw_entities)
                        if isinstance(decoded, list):
                            candidate_entities = decoded
                    except Exception:
                        candidate_entities = []
                elif isinstance(c_raw_entities, list):
                    candidate_entities = c_raw_entities

                resource_claims_for_llm.append(
                    {
                        "id": str(candidate.get("node_id")),
                        "text": claim_props.get("text", ""),
                        "relation_id": claim_props.get("relation_id"),
                        "entities": candidate_entities,
                        "qualifiers": claim_props.get("qualifiers"),
                        "doc_type": claim_props.get("doc_type"),
                        "doc_id": claim_props.get("doc_id"),
                        "doc_title": claim_props.get("doc_title"),
                        "chunk_index": claim_props.get("chunk_index"),
                        "chunk_start": claim_props.get("chunk_start"),
                        "chunk_text": claim_props.get("chunk_text"),
                    }
                )

            # 2) Direct claim-vs-proposition contradictions
            pairwise_contradictions: List[Dict[str, Any]] = []
            if resource_claims_for_llm:
                raw_contradictions = self.get_contradicting_resource_claims(
                    main_claim=main_proposition,
                    resource_claims=resource_claims_for_llm,
                )
                # Join LLM outputs back to full resource-claim objects for clarity
                claims_by_id = {c["id"]: c for c in resource_claims_for_llm}
                for item in raw_contradictions:
                    rc_id = str(item.get("resource_claim_id", ""))
                    if not rc_id:
                        continue
                    rc = claims_by_id.get(rc_id)
                    if not rc:
                        continue
                    pairwise_contradictions.append(
                        {
                            "proposition": {
                                "id": main_proposition["id"],
                                "text": main_proposition["text"],
                                "doc_id": main_proposition.get("doc_id"),
                                "doc_title": main_proposition.get("doc_title"),
                                "chunk_index": main_proposition.get("chunk_index"),
                                "chunk_start": main_proposition.get("chunk_start"),
                                "chunk_text": main_proposition.get("chunk_text"),
                            },
                            "claim": {
                                "id": rc["id"],
                                "text": rc.get("text", ""),
                                "doc_id": rc.get("doc_id"),
                                "doc_title": rc.get("doc_title"),
                                "chunk_index": rc.get("chunk_index"),
                                "chunk_start": rc.get("chunk_start"),
                                "chunk_text": rc.get("chunk_text"),
                            },
                            "reason": item.get("reason", ""),
                        }
                    )

            # 3) Fallback to graph-text assessment if no direct claim contradictions
            graph_text_contradictions: List[Dict[str, Any]] = []
            if not pairwise_contradictions:
                graph_text_result = self.assess_claim_with_graph_text(main_proposition)
                graph_text_contradictions = graph_text_result.get("contradictions", [])

            results.append(
                {
                    "proposition": {
                        "id": main_proposition["id"],
                        "text": main_proposition["text"],
                        "doc_id": main_proposition.get("doc_id"),
                        "doc_title": main_proposition.get("doc_title"),
                        "chunk_index": main_proposition.get("chunk_index"),
                        "chunk_start": main_proposition.get("chunk_start"),
                        "chunk_text": main_proposition.get("chunk_text"),
                    },
                    "pairwise_contradictions": pairwise_contradictions,
                    "graph_text_contradictions": graph_text_contradictions,
                }
            )

        return results

        # Example wireframe of the JSON output:
        # [
        #   {
        #     "proposition": {
        #       "id": "123",
        #       "text": "Our model achieves 90% accuracy on DatasetX.",
        #       "doc_id": "main_doc_1",
        #       "doc_title": "Main Paper Title",
        #       "chunk_index": 0,
        #       "chunk_start": 0,
        #       "chunk_text": "Full text of the first chunk of the main document..."
        #     },
        #     "pairwise_contradictions": [
        #       {
        #         "proposition": {
        #           "id": "123",
        #           "text": "Our model achieves 90% accuracy on DatasetX.",
        #           "doc_id": "main_doc_1",
        #           "doc_title": "Main Paper Title",
        #           "chunk_index": 0,
        #           "chunk_start": 0,
        #           "chunk_text": "Full text of the first chunk of the main document..."
        #         },
        #         "claim": {
        #           "id": "456",
        #           "text": "The same model achieves 75% accuracy on DatasetX.",
        #           "doc_id": 42,
        #           "doc_title": "Supporting Study A",
        #           "chunk_index": 1,
        #           "chunk_start": 2000,
        #           "chunk_text": "Full text of the second chunk of the supporting document..."
        #         },
        #         "reason": "The supporting claim reports 75% accuracy where the proposition reports 90% on the same dataset and setup."
        #       }
        #     ],
        #     "graph_text_contradictions": [
        #       {
        #         "evidence_id": "evidence_3",
        #         "evidence_text": "FACT 17: ModelA -[EVALUATED_ON]-> DatasetX [metric=accuracy, value=0.75]",
        #         "reason": "This fact indicates 75% accuracy on DatasetX, contradicting the proposition's 90% figure."
        #       }
        #     ]
        #   }
        # ]

    def _flatten_properties_for_neo4j(self, properties: Dict[str, Any]) -> Dict[str, Any]:
        """Flatten nested objects/arrays to JSON strings for Neo4j compatibility"""
        flattened = {}
        for key, value in properties.items():
            if isinstance(value, (dict, list)):
                # Convert nested objects/arrays to JSON strings
                flattened[key] = json.dumps(value)
            elif value is None:
                # Skip None values
                continue
            else:
                # Keep primitive types as-is
                flattened[key] = value
        return flattened
    
    def add_claims(self, claims: list, claim_edges: list, graph: Neo4jGraph, type: str) -> None:
        # Create a mapping from claim local IDs to claim data
        claim_map = {}
        
        # First, create all claims and store their local IDs
        for claim in claims:
            # Flatten nested objects (like qualifiers, entities) to JSON strings
            flattened_claim = self._flatten_properties_for_neo4j(claim)
            # Create the node in Neo4j
            node = graph.create_node(label=type, properties=flattened_claim)
            # Store mapping from local ID to claim data (for relationship creation)
            if 'id' in claim:
                claim_map[claim['id']] = {
                    'node_id': node['id'],
                    'properties': claim,
                    'text': claim.get('text', ''),
                    'relation_id': claim.get('relation_id', '')
                }
        
        # Now create claim relationships using the claim mapping
        for edge in claim_edges:
            # Handle both old format and new format
            if 'source_claim_id' in edge and 'target_claim_id' in edge:
                # New format: uses local claim IDs
                source_id = edge['source_claim_id']
                target_id = edge['target_claim_id']
                relation_type = edge.get('relation_type', 'RELATED_TO')
                
                # Look up the claims
                if source_id in claim_map and target_id in claim_map:
                    source_claim = claim_map[source_id]
                    target_claim = claim_map[target_id]
                    
                    # Use claim text as the matching property (or claim ID if text is not unique)
                    source_value = source_claim['text'] or source_id
                    target_value = target_claim['text'] or target_id
                    
                    try:
                        graph.create_relationship(
                            from_label=type,
                            from_property='text',
                            from_value=source_value,
                            to_label=type,
                            to_property='text',
                            to_value=target_value,
                            relationship_type=relation_type,
                            relationship_properties={}
                        )
                    except Exception as e:
                        print(f"Error creating claim relationship: {e}")
                        print(f"Source: {source_value[:50]}, Target: {target_value[:50]}, Type: {relation_type}")
                else:
                    print(f"Warning: Could not find claims for edge {edge.get('id', 'unknown')}")
                    print(f"Source ID: {source_id}, Target ID: {target_id}")
                    print(f"Available claim IDs: {list(claim_map.keys())}")
            else:
                # Old format: direct property access
                try:
                    graph.create_relationship(
                        from_label=edge.get('from_label', 'Claim'),
                        from_property=edge.get('from_property', 'id'),
                        from_value=edge.get('from_value'),
                        to_label=edge.get('to_label', 'Claim'),
                        to_property=edge.get('to_property', 'id'),
                        to_value=edge.get('to_value'),
                        relationship_type=edge.get('relationship_type', 'RELATED_TO'),
                    )
                except Exception as e:
                    print(f"Error creating claim relationship (old format): {e}")
        
        return None
