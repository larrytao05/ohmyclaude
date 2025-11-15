#!/usr/bin/env python3
"""
Example script showing how to create graphs and add nodes to Neo4j.
Run this after starting Neo4j with: docker-compose up -d
"""

from graph_utils import Neo4jGraph
from db_utils import DatabaseUtils

example_claim = "According to the web search results, therecommended first line of treatment for HER2+ metastatic breast cancer is **chemotherapy plusHER2-directed therapy**, which are drugs that target the HER2 protein on cancer cells."
example_supporting_doc = """By Wade Smith, MD, as told to Kara Mayer Robinson. A diagnosis of HER2 positive breast cancer can be frightening at first, especially when you hear the words "aggressive cancer." But there is reason to be optimistic about todays advances in treatment. There is not a one size fits all approach, but with the help of your doctors, you can choose what is best for you.

Your Treatment Is Unique
HER2 positive breast cancer is different from other breast cancer types, so your treatment will not necessarily be the same as someone else who has a different form of breast cancer. It may also be different than another HER2 positive patients therapy. Each cancer is unique, so doctors try to develop the treatment course that is best for you. Things to consider include the size of your tumor, whether the cancer has metastasized (spread), or your overall risk of recurrence.

Treatments You May Consider
The most common treatment for HER2 positive breast cancer is chemotherapy plus HER2 directed therapy. This is followed by surgery, then continues with HER2 directed therapy. This is often best for patients with large tumors or cancer in regional lymph nodes.

For targeted therapy, your doctor may recommend a family of drugs commonly known as monoclonal antibodies. This includes trastuzumab (Herceptin), the first in its class precision therapy drug approved by the FDA for HER2 positive breast cancer.

It is less common, but you may have surgery first, followed by chemotherapy and HER2 directed therapy. Your doctor may choose this sequence if you have a small tumor that is not in your lymph nodes.

Your doctor may also recommend endocrine therapy. This treatment involves taking a daily pill for at least 5 years after you complete chemotherapy and surgery.
"""



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


def example_create_graph():
    """Example: Create a graph with nodes and relationships"""

    #delete existing nodes and relationships
    # graph.delete_all_nodes()
    # graph.delete_all_relationships()
    
    # Initialize connection to Neo4j
    graph = Neo4jGraph()
    # try:
    db_utils = DatabaseUtils(graph)
    
    db_utils.create_document("", example_supporting_doc, "HER2 positive breast cancer", schema=example_schema, project_info="Medical knowledge")
    print("Reached 2")
    
    db_utils.create_main_document("HER2 positive breast cancer", "HER2 positive breast cancer", example_claim, graph, schema=example_schema, project_info="Medical knowledge")
    print("Reached 3")
    
    # Analyze main-document claims for contradictions against the resource graph
    contradictions = db_utils.analyze_main_document_contradictions()
    print("Contradiction analysis results:")
    for result in contradictions:
        print(result)
    # except Exception as e:
    #     print(f"Error: {e}")
    # finally:
    #     graph.close()
    
    


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
