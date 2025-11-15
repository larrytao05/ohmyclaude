    from flask import Flask, request, jsonify
    from flask_cors import CORS
    from graph_utils import get_conflict, Neo4jGraph
    from db_utils import create_document

    app = Flask(__name__)
    CORS(app)  # Enable CORS for all routes

    # Sample data store (in production, use a database)
    data_store = []


    @app.route('/', methods=['GET'])
    def health_check():
        """Health check endpoint"""
        return jsonify({
            'status': 'healthy',
            'message': 'Flask API is running'
        }), 200


    @app.route('/api/data', methods=['GET'])
    def get_conflicts():
        """GET endpoint to retrieve all data"""
        pass

    @app.route('/api/document', methods=['POST'])
    def create_document():
        """POST endpoint to create a new project"""
        desc = request.json.get('desc')
        if not desc:
            return jsonify({
                'success': False,
                'error': 'Desc is required'
            }), 400
        content = request.json.get('content')
        if not content:
            return jsonify({
                'success': False,
                'error': 'Content is required'
            }), 400
        title = request.json.get('title')
        if not title:
            return jsonify({
                'success': False,
                'error': 'Title is required'
            }), 400
        document = create_document(desc, content, title)
        return jsonify({
            'success': True,
            'document': document
        }), 201


    if __name__ == '__main__':
        app.run(debug=True, host='0.0.0.0', port=5000)

