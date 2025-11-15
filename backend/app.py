from flask import Flask, request, jsonify
from flask_cors import CORS
from graph_utils import get_conflict, Neo4jGraph

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


@app.route('/api/data', methods=['POST'])
def create_data():
    """POST endpoint to create new data"""
    pass


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

