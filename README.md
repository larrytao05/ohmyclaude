# ohmyclaude

AI-powered web app built for the CBC hackathon that connects a TypeScript frontend with a Python backend to talk to Claude and automate reasoning-heavy tasks.

> **Note:** This project is structured as a monorepo with `backend/`, `frontend/`, and `logical.ly/` directories. The frontend is written in TypeScript and the backend in Python. **Run `npm run dev` under logical.ly/**

---

## Overview

> ohmyclaude helps users fact check their reasoning as they write, using Claude as the reasoning engine behind the scenes to cross-check information among different source documents.
> This app was built for writers who need to make sure that their every line is free of errors such as circular reasoning, contradictions, false premises, and more.
> We implement knowledge trees in order to merge information across multiple documents to fact-check against the uploaded main document.

---

## Tech Stack

### Frontend
- **Next.js 16** (React 19) with App Router
- **TypeScript**
- **Tailwind CSS v4** for styling
- **next-themes** for theme management
- **pdfjs-dist** for PDF text extraction
- **mammoth** for DOCX text extraction

### Backend
- **Flask** (Python) REST API
- **Neo4j** graph database for knowledge graph storage
- **Anthropic Claude API** for claim extraction and reasoning
- **Flask-CORS** for cross-origin requests

---

## Core Features

- **Multiple File Uploading** – Allows users to upload multiple supporting documents to be parsed into one knowledge tree to be matched against the main document to find logical fallacies
  and factual errors.
- **Error Highlighting** – Errors are highlighted so users can clearly see errors and jump straight to fixing them.

---

## What We Learned

Building ohmyclaude taught us how to combine LLM reasoning with a fully structured knowledge-graph pipeline. Key lessons include:

Working With Multi-Document Extraction

- PDF and DOCX files often extract inconsistently

- We learned how to normalize and preprocess text for LLM reliability

- We discovered the value of chunking long documents to preserve context

Designing LLM-Friendly Prompts

- Claim extraction requires strict schema design

- We found that small examples were more effective than long instructions

- Consistency in output formatting dramatically reduced backend errors

Graph-Based Reasoning

- Neo4j made it easier to merge, store, and query extracted relationships

- We learned best practices for modeling claims, entities, and sources

- Graph traversal worked beautifully with LLM outputs

Frontend–Backend Coordination

- Combining TypeScript, Python, and Neo4j in a monorepo taught us
how to maintain clean API boundaries

- Learned the importance of progressive extraction UI and user feedback

--

## Installation



### Prerequisites

- Node.js 18+ and npm
- Python 3.8+
- Neo4j database (local or cloud instance)
- Anthropic API key

### Frontend Setup

```bash
cd logical.ly
npm install
npm run dev
```

The frontend will be available at [http://localhost:3000](http://localhost:3000)

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in the `backend` directory:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password
```

Run the Flask server:

```bash
python app.py
# or
flask run
```

The backend API will be available at [http://localhost:5000](http://localhost:5000)

### Neo4j Setup

You can run Neo4j locally using Docker:

```bash
cd backend
docker-compose up -d
```

Or use Neo4j Aura (cloud) and update the connection details in your `.env` file.

## Usage Guide

### Getting Started

Once the application is running at [http://localhost:3000](http://localhost:3000), follow these steps:

#### Step 1: Navigate to the Upload Page

- From the home page, click **"Get Started"** or **"Start Analyzing"** button
- Or directly navigate to `/upload` in your browser

#### Step 2: Fill in Project Information

On the upload page, you'll see a form split into two sections:

**Left Section (1/3 of screen):**
- **Title**: Enter a descriptive title for your project (e.g., "Research Paper Fact-Check")
- **Project Description**: Provide context about what you're fact-checking
- **Technical Domain**: Select the relevant domain from the dropdown:
  - Software Engineering
  - Data Science
  - Machine Learning
  - Web Development
  - Mobile Development
  - DevOps
  - Cybersecurity
  - Cloud Computing
  - Other

**Right Section (2/3 of screen):**
- **Upload Supporting Documents**: 
  - Click the upload area or drag and drop files
  - Supported formats: PDF, DOC, DOCX, TXT
  - Upload at least one supporting document
  - Each uploaded file appears in a summary list at the top

#### Step 3: Add Document Descriptions

- Click the arrow next to each uploaded file to expand its description box
- Add a brief description explaining what the document contains
- This helps the system understand the context of each source

#### Step 4: Submit Your Project

- The **"Upload"** button (bottom right) will be enabled once all required fields are filled
- Click "Upload" to process your documents
- A progress bar will show the extraction progress
- Once complete, you'll be redirected to the editor page

#### Step 5: Upload Main Document (Editor Page)

- In the editor page, upload the main document you want to fact-check
- The system will extract text and compare claims against your supporting documents
- Results will be displayed with color-coded highlighting

#### Additional Features

- **Dark Mode Toggle**: Click the moon/sun icon in the top right to switch themes
- **Clear All Fields**: Use the "Clear All Fields" button to reset form inputs
- **Clear All Files**: Use the "Clear All Files" button to remove all uploaded documents
- **Form Validation**: Error messages appear after you click into and leave a field empty
- **Exit Confirmation**: If you try to leave with unsaved data, a confirmation dialog will appear

## How It Works

1. **Document Processing**: 
   - Supporting documents are uploaded and their text content is extracted
   - Text is stored in JSON format along with metadata

2. **Knowledge Graph Construction**:
   - The backend processes supporting documents
   - Claude AI extracts claims, entities, and relationships
   - A knowledge graph is built in Neo4j

3. **Claim Extraction**:
   - The main document is processed to extract claims
   - Each claim is compared against the knowledge graph

4. **Analysis & Highlighting**:
   - Claims are categorized as supported, contradicted, or uncertain
   - The main document is displayed with inline highlighting
   - Explanations are generated for each relationship

## API Endpoints

### Frontend (Next.js API Routes)
- `POST /api/save-project-data` - Save project metadata and file information
- `GET /api/project` - Retrieve project data
- `GET /api/project-files` - Get project files
- `POST /api/fact-check` - Submit document for fact-checking
- `GET /api/fact-claims` - Get fact-checking results

### Backend (Flask)
- `GET /` - Health check
- `POST /api/document` - Create a new document in the knowledge graph
- `GET /api/data` - Retrieve conflicts/claims data

## Development

### Frontend Development
```bash
cd logical.ly
npm run dev
```

### Backend Development
```bash
cd backend
python app.py
```

## Challenges & Solutions

### 1. PDF.js Worker Loading Issues

**Challenge**: PDF.js requires a web worker to parse PDF files, but loading the worker from CDN URLs caused CORS and module resolution errors in Next.js.

**Solution**: 
- Copied the worker file to the `public/` directory
- Configured the worker to load from the local file using `window.location.origin`
- Added fallback handling to disable the worker if loading fails
- This ensures reliable PDF text extraction without external dependencies

### 2. Dark Mode Transition Performance

**Challenge**: Smooth color transitions for dark mode were causing performance issues and making the UI feel sluggish when toggling themes.

**Solution**:
- Disabled color transitions globally using CSS `transition-property` overrides
- Kept transitions only for interactive elements (hover effects, transforms)
- Set `disableTransitionOnChange={true}` in the ThemeProvider
- Result: Instant theme switching while maintaining smooth hover animations

### 3. Form Validation UX

**Challenge**: Showing validation errors immediately on page load created a poor user experience with red error states before users even interacted with the form.

**Solution**:
- Implemented a "touched fields" state tracking system
- Errors only appear after a user clicks into a field and then leaves it empty
- Clear buttons reset both form values and touched state
- Added helpful tooltips on the disabled submit button explaining missing requirements
- This provides feedback only when needed, reducing visual noise

### 4. File Text Extraction

**Challenge**: Extracting text from different file formats (PDF, DOCX, TXT) required different parsing strategies and handling edge cases.

**Solution**:
- Used `pdfjs-dist` for PDF parsing with proper worker configuration
- Implemented `mammoth` library for DOCX files (ready for implementation)
- Used native `File.text()` API for plain text files
- Added comprehensive error handling and logging for debugging
- Progress tracking during extraction to show user feedback

### 5. TypeScript Type Safety

**Challenge**: Working with dynamic file types and PDF.js required proper type definitions to avoid runtime errors.

**Solution**:
- Created custom type definitions for PDF.js in `types/pdfjs.d.ts`
- Used TypeScript interfaces for file metadata (`FileWithDescription`)
- Added proper type annotations for event handlers and async functions
- Leveraged TypeScript's strict mode for catching errors early

## Future Plans

With more time, here's what we would build next:

### Immediate Priorities

1. **Complete DOCX Support**
   - Fully implement `mammoth` library integration for DOCX text extraction
   - Handle complex formatting and embedded content
   - Support for older `.doc` format using alternative libraries

2. **Project QoL**
   - Support mutliple project tabs to support switching to different documents and works
   - Sidebar to chat with a Claude AI assistant
   - Click-to-view evidence modal with source citations

### Enhanced Features

4. **Knowledge Graph Visualization**
   - Interactive graph viewer using D3.js or vis.js
   - Visual representation of entities and relationships
   - Filtering and search capabilities
   - Export graph as image or JSON

5. **Advanced Claim Analysis**
   - Confidence scoring for each claim
   - Source reliability ratings
   - Temporal analysis (claims that changed over time)
   - Contradiction severity levels

6. **User Experience Improvements**
   - Save and load projects
   - Project history and versioning
   - Export results as PDF, Word, or Markdown
   - Keyboard shortcuts for power users
   - Undo/redo functionality

### Technical Enhancements

7. **Testing & Quality**
   - Unit tests for utility functions
   - Integration tests for API routes
   - E2E tests for critical user flows
   - Performance benchmarking

### Long-term Vision

8. **Multi-user Collaboration**
    - User authentication and authorization
    - Shared projects and workspaces
    - Comments and annotations
    - Real-time collaborative editing

9. **Browser Extension**
    - Fact-check any webpage in real-time
    - Highlight claims automatically
    - Quick access to knowledge graph
    - Integration with popular browsers

---

## Accomplishments We’re Proud Of

Fully Functional Multi-Format Document Parser
# We successfully combined:
- PDF.js
- Mammoth (DOCX)
- Native text extraction
into a unified pipeline.

# Automated Knowledge Graph Creation
We generated a dynamic Neo4j graph from multiple documents and used it to:
- Compare claims
- Detect contradictions
- Link evidence back to sources

# Intuitive, Real-Time Fact-Checking UI
We built a clean Next.js 16 interface that:
- Shows highlighted claims
- Lets users explore reasoning
- Handles dark mode, validation, and extraction progress

# A True Full-Stack Monorepo
We integrated:
- TypeScript
- Python
- Neo4j
- Claude API

## Contributors:
Larry Tao:
Nathan Dang: Implemented editor page as well as fact-checking feature. Created API calls for backend knowledge base processing.
Rohan Mahajan:
Shane Lee: Implemented front-end, design process, file upload, and app integration
