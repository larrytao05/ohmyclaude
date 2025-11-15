import psycopg2
import os
import anthropic
from graph_utils import Neo4jGraph
from typing import Dict, Any, List, Tuple, Optional
import json


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
        """Create a new document"""
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
        # for each chunk, extract claims
        if schema and project_info:
            print(f"Schema: {schema}")
            print(f"Project info: {project_info}")
        for chunk in chunks:
            print(f"Extracting entities and relationships from chunk: {chunk}")
            # extract entities and relationships
            entities, relationships, claims, claim_edges = self.extract_entities(chunk, schema, project_info)
            print(f"Entities: {entities}")
            print(f"Relationships: {relationships}")
            # deduplicate entities
            deduplicated_entities = self.deduplicate_entities(entities)
            # add entities and relationships to database
            self.add_entities(entities, relationships, claims, claim_edges)
        return result

    def create_main_document(self, title: str, desc: str, content: str, graph: Neo4jGraph, schema: str = "Return all claims and relationships", project_info: Dict[str, Any] = None, doc_id: str = None) -> None:
        """Create a main document"""
        chunks = [content[i:i+2000] for i in range(0, len(content), 2000)]
        if schema and project_info:
            for idx, chunk in enumerate(chunks):
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
            # deduplicate claims
                deduplicated_claims = self.deduplicate_claims(claims)
            # add entities and relationships to database
                self.add_claims(deduplicated_claims, claim_edges, graph)

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
            self.add_claims(claims, claim_edges, self.graph)
        
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
    
    def add_claims(self, claims: list, claim_edges: list, graph: Neo4jGraph) -> None:
        # Create a mapping from claim local IDs to claim data
        claim_map = {}
        
        # First, create all claims and store their local IDs
        for claim in claims:
            # Flatten nested objects (like qualifiers, entities) to JSON strings
            flattened_claim = self._flatten_properties_for_neo4j(claim)
            # Create the node in Neo4j
            node = graph.create_node(label="Claim", properties=flattened_claim)
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
                            from_label='Claim',
                            from_property='text',
                            from_value=source_value,
                            to_label='Claim',
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

    #def detect_conflicts


