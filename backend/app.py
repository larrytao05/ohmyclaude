from flask import Flask, request, jsonify
from flask_cors import CORS
from graph_utils import Neo4jGraph
from db_utils import DatabaseUtils

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Single shared Neo4j / DB utils instance for this process
graph = Neo4jGraph()
db_utils = DatabaseUtils(graph)



example_schema = {
  "entity_types": [
    {
      "id": "MedicalCondition",
      "label": "Medical Condition",
      "description": "A disease, disorder, or clinical state referenced by claims or evidence.",
      "attributes": ["name", "category"]
    },
    {
      "id": "MedicalIntervention",
      "label": "Medical Intervention",
      "description": "A treatment, therapy, procedure, or drug relevant to medical evidence.",
      "attributes": ["type", "mechanism"]
    },
    {
      "id": "PopulationGroup",
      "label": "Population Group",
      "description": "A demographic or clinical subgroup applicable to medical statements.",
      "attributes": ["age_range", "sex", "risk_category"]
    },
    {
      "id": "Study",
      "label": "Study",
      "description": "A clinical or observational study providing evidence used for fact-checking.",
      "attributes": ["study_type", "year", "sample_size"]
    },
    {
      "id": "StudyDesign",
      "label": "Study Design",
      "description": "The methodological structure of a study such as RCT or cohort design.",
      "attributes": ["design_type"]
    },
    {
      "id": "OutcomeMeasure",
      "label": "Outcome Measure",
      "description": "A specific endpoint or metric assessed in medical studies.",
      "attributes": ["name", "measurement_type"]
    },
    {
      "id": "Measurement",
      "label": "Measurement",
      "description": "A numerical or categorical value quantifying an outcome.",
      "attributes": ["value", "unit"]
    },
    {
      "id": "Guideline",
      "label": "Guideline",
      "description": "A clinical guideline or recommendation relevant to medical claims.",
      "attributes": ["organization", "publication_year"]
    },
    {
      "id": "RiskFactor",
      "label": "Risk Factor",
      "description": "A variable or attribute associated with increased likelihood of a condition.",
      "attributes": ["factor_type"]
    },
    {
      "id": "EvidenceStatement",
      "label": "Evidence Statement",
      "description": "A structured or textual piece of evidence derived from study findings.",
      "attributes": ["text"]
    }
  ],

  "relationship_types": [
    {
      "id": "investigates",
      "label": "Investigates",
      "description": "A study investigates a particular medical condition.",
      "source_type": "Study",
      "target_type": "MedicalCondition"
    },
    {
      "id": "evaluates_intervention",
      "label": "Evaluates Intervention",
      "description": "A study evaluates the effects of a medical intervention.",
      "source_type": "Study",
      "target_type": "MedicalIntervention"
    },
    {
      "id": "reports_outcome",
      "label": "Reports Outcome",
      "description": "A study reports an outcome measure.",
      "source_type": "Study",
      "target_type": "OutcomeMeasure"
    },
    {
      "id": "quantified_by",
      "label": "Quantified By",
      "description": "An outcome measure is quantified by a measurement.",
      "source_type": "OutcomeMeasure",
      "target_type": "Measurement"
    },
    {
      "id": "applies_to_population",
      "label": "Applies to Population",
      "description": "A study is associated with a specific population group.",
      "source_type": "Study",
      "target_type": "PopulationGroup"
    },
    {
      "id": "has_design",
      "label": "Has Study Design",
      "description": "A study has a specific study design.",
      "source_type": "Study",
      "target_type": "StudyDesign"
    },
    {
      "id": "recommended_by",
      "label": "Recommended By",
      "description": "A medical intervention is recommended by a clinical guideline.",
      "source_type": "MedicalIntervention",
      "target_type": "Guideline"
    },
    {
      "id": "associated_with_risk",
      "label": "Associated With Risk",
      "description": "A medical condition is associated with a risk factor.",
      "source_type": "MedicalCondition",
      "target_type": "RiskFactor"
    },
    {
      "id": "supports_evidence",
      "label": "Supports Evidence",
      "description": "A study supports an evidence statement.",
      "source_type": "Study",
      "target_type": "EvidenceStatement"
    },
    {
      "id": "evidence_about_condition",
      "label": "Evidence About Condition",
      "description": "An evidence statement refers to or concerns a medical condition.",
      "source_type": "EvidenceStatement",
      "target_type": "MedicalCondition"
    },
    {
      "id": "evidence_about_intervention",
      "label": "Evidence About Intervention",
      "description": "An evidence statement concerns a medical intervention.",
      "source_type": "EvidenceStatement",
      "target_type": "MedicalIntervention"
    },
    {
      "id": "addresses_outcome",
      "label": "Addresses Outcome",
      "description": "A medical intervention affects or targets an outcome measure.",
      "source_type": "MedicalIntervention",
      "target_type": "OutcomeMeasure"
    }
  ]
}


@app.route('/', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Flask API is running'
    }), 200


@app.route('/api/supporting-document/', methods=['POST'])
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
    schema = example_schema
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


@app.route('/api/main-document/', methods=['POST'])
def create_main_document():
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
    schema = example_schema
    project_info = data.get('project_info') or "Medical knowledge"

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

    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error processing main document: {e}',
        }), 500

    return jsonify({
        'success': True,
    }), 200


@app.route('/api/contradictions/', methods=['GET'])
def get_contradictions():
    """
    Analyze all main-document propositions for contradictions against resource claims.
    
    Returns a JSON array of analysis results, one per proposition, including:
    - proposition: The main document proposition being analyzed
    - pairwise_contradictions: List of resource claims that contradict the proposition
    - graph_text_contradictions: Fallback contradictions from graph text export
    """
    try:
        analysis = db_utils.analyze_main_document_contradictions()
        return jsonify({
            'success': True,
            'analysis': analysis,
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error analyzing contradictions: {e}',
        }), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
