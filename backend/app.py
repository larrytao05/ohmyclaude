from flask import Flask, request, jsonify
from flask_cors import CORS
from graph_utils import Neo4jGraph
from db_utils import DatabaseUtils

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Single shared Neo4j / DB utils instance for this process
graph = Neo4jGraph()
db_utils = DatabaseUtils(graph)


@app.route('/', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Flask API is running'
    }), 200


@app.route('/api/supporting-document', methods=['POST'])
def create_supporting_document():
    """
    Ingest a supporting document and extract entities/relationships into the graph.

    Expected JSON body:
    {
      "title": string,
      "content": string,
      "description": string,           # optional
      "schema": string | object,       # optional, defaults to generic schema prompt
      "project_info": object           # optional, defaults to {}
    }
    """
    data = request.get_json(silent=True) or {}

    title = data.get('title')
    content = data.get('content')
    desc = data.get('description', '') or ''
    schema = data.get('schema') or "Include any entity and relationship type"
    project_info = data.get('project_info') or {}

    if not title or not content:
        return jsonify({
            'success': False,
            'error': 'Both "title" and "content" are required.'
        }), 400

    try:
        doc_id = db_utils.create_document(
            description=desc,
            content=content,
            title=title,
            schema=schema,
            project_info=project_info,
        )
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error creating supporting document: {e}',
        }), 500

    return jsonify({
        'success': True,
        'supporting_document_id': doc_id,
    }), 201


@app.route('/api/main-document', methods=['POST'])
def create_main_document_and_analyze():
    """
    Ingest a main document, extract claims into the graph, and analyze contradictions.

    Expected JSON body:
    {
      "title": string,
      "content": string,
      "description": string,           # optional
      "schema": string | object,       # optional, defaults to generic claim schema prompt
      "project_info": object           # optional, defaults to {}
    }

    Response includes per-claim contradiction analysis.
    """
    data = request.get_json(silent=True) or {}

    title = data.get('title')
    content = data.get('content')
    desc = data.get('description', '') or ''
    schema = data.get('schema') or "Return all claims and relationships"
    project_info = data.get('project_info') or {}

    if not title or not content:
        return jsonify({
            'success': False,
            'error': 'Both "title" and "content" are required.'
        }), 400

    try:
        # Extract claims and add them to the graph
        db_utils.create_main_document(
            title=title,
            desc=desc,
            content=content,
            graph=graph,
            schema=schema,
            project_info=project_info,
            doc_id=title,
        )

        # Analyze contradictions for all main-document claims
        analysis = db_utils.analyze_main_document_contradictions()
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error processing main document: {e}',
        }), 500

    return jsonify({
        'success': True,
        'analysis': analysis,
    }), 200


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
