'use client';

import Link from 'next/link';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import mammoth from 'mammoth';
import projectData from '../data/project-data.json';
import ThemeToggle from './components/ThemeToggle';
import { postSupportingDocument } from '../lib/supporting-documents';
import { postMainDocument } from '../lib/main-document';

const TECHNICAL_DOMAINS = [
  { value: '', label: 'Select a domain' },
  { value: 'software-engineering', label: 'Software Engineering' },
  { value: 'data-science', label: 'Data Science' },
  { value: 'machine-learning', label: 'Machine Learning' },
  { value: 'web-development', label: 'Web Development' },
  { value: 'mobile-development', label: 'Mobile Development' },
  { value: 'devops', label: 'DevOps' },
  { value: 'cybersecurity', label: 'Cybersecurity' },
  { value: 'cloud-computing', label: 'Cloud Computing' },
  { value: 'other', label: 'Other' },
];

type UploadedFile = {
  fileName: string;
  fileType: string;
  description: string;
  order: number;
  content?: string;
};

type ProjectData = {
  title?: string;
  projectDescription?: string;
  technicalDomain?: string;
  uploadedFiles?: UploadedFile[];
};

interface SupportingDocument {
  document_title: string;
  description: string;
  fileType: string;
  order: number;
  content?: string;
}

type ClaimSpan = {
  id: string;
  claimText: string;
  startChar: number;
  endChar: number;
  searchQuery: string;
};

type ClaimCheckResult = {
  id: string;
  verdict: 'contradicted' | 'uncertain';
  suggestion?: string;
  correction?: string;
  correctionSource?: string;
  evidence?: { snippet: string; sourceUrl: string }[];
};

type LogicalDocumentRef = {
  id: string | number;
  text: string;
  doc_id: string | number;
  doc_title: string;
  chunk_index: number;
  chunk_start: number;
  chunk_text?: string;
};

type LogicalPairwiseContradiction = {
  proposition: LogicalDocumentRef;
  claim: LogicalDocumentRef;
  reason: string;
};

type LogicalGraphContradiction = {
  evidence_id: string;
  evidence_text: string;
  reason: string;
};

type LogicalDiscrepancyResult = {
  proposition: LogicalDocumentRef;
  pairwise_contradictions: LogicalPairwiseContradiction[];
  graph_text_contradictions: LogicalGraphContradiction[];
};

type LogicalAnalysisResponse = {
  success?: boolean;
  analysis?: LogicalDiscrepancyResult[];
};

type HighlightVerdict = ClaimCheckResult['verdict'] | 'contradiction';

type HighlightSegment =
  | { type: 'text'; text: string }
  | {
    type: 'highlight';
    mode: 'fact-check' | 'logical';
    text: string;
    verdict: HighlightVerdict;
    claimText: string;
    suggestion?: string;
    correction?: string;
    correctionSource?: string;
    evidence?: { snippet: string; sourceUrl: string }[];
    tag?: 'contradiction';
    logicalDetails?: LogicalDiscrepancyResult;
  };

type SelectedInsightState =
  | {
    mode: 'fact-check';
    text: string;
    verdict: HighlightVerdict;
    suggestion?: string;
    correction?: string;
    correctionSource?: string;
    evidence?: { snippet: string; sourceUrl: string }[];
  }
  | {
    mode: 'logical';
    proposition: LogicalDocumentRef;
    pairwiseContradictions: LogicalPairwiseContradiction[];
    graphContradictions: LogicalGraphContradiction[];
  };

type AnalysisMode = 'fact-check' | 'logical';

export default function Editor() {
  const typedProjectData = projectData as ProjectData;
  const initialTitle =
    typedProjectData.title && typedProjectData.title.trim().length > 0
      ? typedProjectData.title.trim()
      : 'Untitled project';
  const initialDescription = typedProjectData.projectDescription ?? '';
  const initialDomain = typedProjectData.technicalDomain ?? '';

  const [content, setContent] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [documents, setDocuments] = useState<SupportingDocument[]>(() => {
    const uploadedFiles = typedProjectData.uploadedFiles ?? [];
    return uploadedFiles.map((file) => ({
      document_title: file.fileName,
      description: file.description || 'No description provided.',
      fileType: file.fileType,
      order: file.order,
      content: file.content ?? '',
    }));
  });
  const [projectInfo, setProjectInfo] = useState({
    title: initialTitle,
    projectDescription: initialDescription,
    technicalDomain: initialDomain,
  });
  const [projectForm, setProjectForm] = useState(projectInfo);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSavingProjectInfo, setIsSavingProjectInfo] = useState(false);
  const [isAnalysisSidebarOpen, setIsAnalysisSidebarOpen] = useState(false);
  const [isAnalysisSidebarMounted, setIsAnalysisSidebarMounted] = useState(false);
  const [isAnalysisView, setIsAnalysisView] = useState(false);
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [claims, setClaims] = useState<ClaimSpan[]>([]);
  const [factCheckResults, setFactCheckResults] = useState<ClaimCheckResult[]>([]);
  const [isFactCheckLoading, setIsFactCheckLoading] = useState(false);
  const [factCheckError, setFactCheckError] = useState<string | null>(null);
  const [logicalResults, setLogicalResults] = useState<LogicalDiscrepancyResult[]>([]);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('fact-check');
  const [selectedInsight, setSelectedInsight] = useState<SelectedInsightState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isSupportUploadModalOpen, setIsSupportUploadModalOpen] = useState(false);
  const [supportUploadFile, setSupportUploadFile] = useState<File | null>(null);
  const [supportUploadDescription, setSupportUploadDescription] = useState('');
  const [isSavingSupportUpload, setIsSavingSupportUpload] = useState(false);
  const [supportUploadError, setSupportUploadError] = useState<string | null>(null);
  const [isLogicalCheckLoading, setIsLogicalCheckLoading] = useState(false);
  const [logicalCheckError, setLogicalCheckError] = useState<string | null>(null);
  const [logicalCheckSuccess, setLogicalCheckSuccess] = useState<string | null>(null);

  const hasFactResults = factCheckResults.length > 0;
  const hasLogicalResults = logicalResults.length > 0;
  const hasAnyAnalysisResults = hasFactResults || hasLogicalResults;
  const canShowAnalysisContent =
    (analysisMode === 'fact-check' && hasFactResults) ||
    (analysisMode === 'logical' && hasLogicalResults);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
  }, []);

  const extractTextFromDocument = useCallback(async (file: File) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    let extractedText = '';

    if (fileExtension === 'pdf') {
      const pdfjsLib = await import('pdfjs-dist/build/pdf');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const textParts: string[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        textParts.push(pageText);
      }

      extractedText = textParts.join('\n\n');
    } else if (fileExtension === 'docx') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      extractedText = result.value;
    } else {
      extractedText = await file.text();
    }

    return extractedText;
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const extractedText = await extractTextFromDocument(file);
      setContent(extractedText);
      setUploadedFileName(file.name);
    } catch (error) {
      console.error('Error reading file:', error);
      alert('Error reading file. Please try a different file or format.');
    }

    // Reset the input value so the same file can be uploaded again
    e.target.value = '';
  }, [extractTextFromDocument]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRunFactCheck = useCallback(async () => {
    setIsFactCheckLoading(true);
    setFactCheckError(null);
    setIsAnalysisView(false);

    try {
      const claimResponse = await fetch('/api/fact-claims', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!claimResponse.ok) {
        const errorBody = await claimResponse.json();
        throw new Error(errorBody.error ?? 'Failed to extract claims.');
      }

      const claimData = await claimResponse.json();
      const extractedClaims: ClaimSpan[] = claimData.claims ?? [];

      if (extractedClaims.length === 0) {
        setClaims([]);
        setFactCheckResults([]);
        setFactCheckError('No fact-checkable claims were found in the document.');
        return;
      }

      setClaims(extractedClaims);

      const factResponse = await fetch('/api/fact-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claims: extractedClaims }),
      });

      if (!factResponse.ok) {
        const errorBody = await factResponse.json();
        throw new Error(errorBody.error ?? 'Fact check failed.');
      }

      const data = await factResponse.json();
      const results = data.results ?? [];
      setFactCheckResults(results);
      setIsAnalysisView(results.length > 0);
      if (results.length > 0) {
        setAnalysisMode('fact-check');
        setSelectedInsight(null);
      }
    } catch (error) {
      console.error('Error running fact check:', error);
      setFactCheckResults([]);
      setFactCheckError(
        error instanceof Error ? error.message : 'Unable to fact-check right now.',
      );
    } finally {
      setIsFactCheckLoading(false);
    }
  }, [content]);

  const handleCheckLogicalDiscrepancies = useCallback(async () => {
    if (!content.trim()) {
      setLogicalCheckError('Please enter or upload document content before running this check.');
      setLogicalCheckSuccess(null);
      return;
    }

    setIsLogicalCheckLoading(true);
    setLogicalCheckError(null);
    setLogicalCheckSuccess(null);

    try {
      const response = await postMainDocument({
        title: uploadedFileName || projectInfo.title || 'Main Document',
        content,
        description: projectInfo.projectDescription ?? '',
        schema: '',
        projectInfo,
      });

      const responseObj = response as LogicalAnalysisResponse | LogicalDiscrepancyResult[] | null;
      const results = Array.isArray(responseObj)
        ? responseObj
        : Array.isArray(responseObj?.analysis)
          ? responseObj.analysis ?? []
          : [];
      const apiSuccess =
        responseObj && !Array.isArray(responseObj) && typeof responseObj === 'object'
          ? responseObj.success
          : undefined;

      setLogicalResults(results);
      setSelectedInsight(null);

      if (results.length > 0) {
        setAnalysisMode('logical');
        setIsAnalysisView(true);
        const suffix =
          apiSuccess === false ? ' (partial response from analyzer)' : '';
        setLogicalCheckSuccess(
          `Detected ${results.length} logical contradiction${results.length === 1 ? '' : 's'}${suffix}.`,
        );
      } else {
        const noResultMsg =
          apiSuccess === false
            ? 'Analyzer returned no contradictions. Please retry in a moment.'
            : 'No logical contradictions detected.';
        setLogicalCheckSuccess(noResultMsg);
        setIsAnalysisView(false);
      }
    } catch (error) {
      console.error('Failed to check logical discrepancies:', error);
      setLogicalResults([]);
      setLogicalCheckError(
        error instanceof Error ? error.message : 'Failed to start logical discrepancy check.',
      );
      setLogicalCheckSuccess(null);
    } finally {
      setIsLogicalCheckLoading(false);
    }
  }, [content, projectInfo, uploadedFileName]);

  const verdictTextClass = (verdict: HighlightVerdict) =>
    verdict === 'contradicted' || verdict === 'contradiction'
      ? 'bg-red-100/80 text-red-900 border border-red-200 dark:bg-red-900/30 dark:text-red-100 dark:border-red-800'
      : 'bg-amber-100/80 text-amber-900 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-700';

  const verdictPillClass = (verdict: HighlightVerdict) =>
    verdict === 'contradicted' || verdict === 'contradiction'
      ? 'bg-red-100 text-red-900 border border-red-200 dark:bg-red-900/40 dark:text-red-100 dark:border-red-800'
      : 'bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700';

  const verdictLabel = (verdict: HighlightVerdict) =>
    verdict === 'contradiction' ? 'Contradiction' : verdict === 'contradicted' ? 'Contradicted' : 'Uncertain';

  const highlightSegments = useMemo<HighlightSegment[]>(() => {
    if (!content) {
      return [];
    }

    const useFactHighlights = analysisMode === 'fact-check' && hasFactResults;
    const useLogicalHighlights = analysisMode === 'logical' && hasLogicalResults;

    if (!useFactHighlights && !useLogicalHighlights) {
      return [{ type: 'text', text: content }];
    }

    const assignedRanges: Array<{ start: number; end: number }> = [];
    const contentLength = content.length;

    const findAvailableRange = (needle: string) => {
      if (!needle) return null;
      let searchIndex = 0;
      while (searchIndex < contentLength) {
        const idx = content.indexOf(needle, searchIndex);
        if (idx === -1) break;
        const start = idx;
        const end = idx + needle.length;

        const overlaps = assignedRanges.some(
          (range) => Math.max(range.start, start) < Math.min(range.end, end),
        );

        if (!overlaps) {
          assignedRanges.push({ start, end });
          return { start, end };
        }

        searchIndex = idx + 1;
      }

      return null;
    };

    type Span =
      | {
        mode: 'fact-check';
        start: number;
        end: number;
        verdict: HighlightVerdict;
        claimText: string;
        suggestion?: string;
        correction?: string;
        correctionSource?: string;
        evidence?: { snippet: string; sourceUrl: string }[];
      }
      | {
        mode: 'logical';
        start: number;
        end: number;
        claimText: string;
        logicalDetails: LogicalDiscrepancyResult;
      };

    const spans: Span[] = (useFactHighlights
      ? factCheckResults
        .map((result) => {
          const claim = claims.find((c) => c.id === result.id);
          const claimText = claim?.claimText?.trim();
          if (!claimText) return null;

          const range = findAvailableRange(claimText);
          if (!range) return null;

          return {
            mode: 'fact-check' as const,
            start: range.start,
            end: range.end,
            verdict: result.verdict as HighlightVerdict,
            claimText,
            suggestion: result.suggestion,
            correction: result.correction,
            correctionSource: result.correctionSource,
            evidence: result.evidence ?? [],
          };
        })
        .filter(Boolean)
      : logicalResults
        .map((result) => {
          const snippet =
            result.proposition.chunk_text?.trim() ||
            result.proposition.text?.trim() ||
            '';
          if (!snippet) return null;

          const range = findAvailableRange(snippet);
          if (!range) return null;

          return {
            mode: 'logical' as const,
            start: range.start,
            end: range.end,
            claimText: snippet,
            logicalDetails: result,
          };
        })
        .filter(Boolean)) as Span[];

    spans.sort((a, b) => a.start - b.start);

    const segments: HighlightSegment[] = [];
    let cursor = 0;

    spans.forEach((span) => {
      if (span.start > cursor) {
        segments.push({
          type: 'text',
          text: content.slice(cursor, span.start),
        });
      }

      if (span.mode === 'fact-check') {
        segments.push({
          type: 'highlight',
          mode: 'fact-check',
          text: content.slice(span.start, span.end),
          verdict: span.verdict,
          claimText: span.claimText,
          suggestion: span.suggestion,
          correction: span.correction,
          correctionSource: span.correctionSource,
          evidence: span.evidence,
        });
      } else {
        segments.push({
          type: 'highlight',
          mode: 'logical',
          text: content.slice(span.start, span.end),
          verdict: 'contradiction',
          claimText: span.claimText,
          tag: 'contradiction',
          logicalDetails: span.logicalDetails,
        });
      }

      cursor = span.end;
    });

    if (cursor < contentLength) {
      segments.push({
        type: 'text',
        text: content.slice(cursor),
      });
    }

    return segments;
  }, [analysisMode, content, claims, factCheckResults, hasFactResults, hasLogicalResults, logicalResults]);

  const handleHighlightSelect = useCallback(
    (segment: Extract<HighlightSegment, { type: 'highlight' }>) => {
      if (segment.mode === 'logical' && segment.logicalDetails) {
        setSelectedInsight({
          mode: 'logical',
          proposition: segment.logicalDetails.proposition,
          pairwiseContradictions: segment.logicalDetails.pairwise_contradictions,
          graphContradictions: segment.logicalDetails.graph_text_contradictions,
        });
        return;
      }

      setSelectedInsight({
        mode: 'fact-check',
        text: segment.text,
        verdict: segment.verdict,
        suggestion: segment.suggestion,
        correction: segment.correction,
        correctionSource: segment.correctionSource,
        evidence: segment.evidence ?? [],
      });
    },
    [],
  );

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
    setOpenMenuIndex(null);
  }, []);

  const toggleMenu = useCallback((index: number) => {
    setOpenMenuIndex(prev => prev === index ? null : index);
  }, []);

  const updateProjectFile = useCallback(async (order: number, updates: Partial<{ fileName: string; description: string; content: string }>) => {
    const response = await fetch('/api/project-files', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, updates }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to update project data.';
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          errorMessage = errorBody.error;
        }
      } catch {
        // ignore
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }, []);

  const handleEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditDescription(documents[index].description);
    setOpenMenuIndex(null);
  }, [documents]);

  const handleSaveEdit = useCallback(async () => {
    if (editingIndex === null) return;

    const targetDocument = documents[editingIndex];
    if (!targetDocument) return;

    const previousDocuments = documents;
    const updatedDocuments = documents.map((doc, idx) =>
      idx === editingIndex ? { ...doc, description: editDescription } : doc
    );
    setDocuments(updatedDocuments);
    setIsSavingEdit(true);

    try {
      await updateProjectFile(targetDocument.order, { description: editDescription });
      setEditingIndex(null);
      setEditDescription('');
    } catch (error) {
      console.error('Failed to update description:', error);
      alert('Failed to update description. Please try again.');
      setDocuments(previousDocuments);
    } finally {
      setIsSavingEdit(false);
    }
  }, [documents, editDescription, editingIndex, updateProjectFile]);

  const handleRename = useCallback((index: number) => {
    setRenamingIndex(index);
    setRenameValue(documents[index].document_title);
    setOpenMenuIndex(null);
  }, [documents]);

  const handleSaveRename = useCallback(async () => {
    if (renamingIndex === null) return;
    const newName = renameValue.trim();
    if (!newName) {
      alert('Document name cannot be empty.');
      return;
    }

    const targetDocument = documents[renamingIndex];
    if (!targetDocument) return;

    const previousDocuments = documents;
    const updatedDocuments = documents.map((doc, idx) =>
      idx === renamingIndex ? { ...doc, document_title: newName } : doc
    );
    setDocuments(updatedDocuments);
    setIsSavingRename(true);

    try {
      await updateProjectFile(targetDocument.order, { fileName: newName });
      setRenamingIndex(null);
      setRenameValue('');
    } catch (error) {
      console.error('Failed to rename document:', error);
      alert('Failed to rename document. Please try again.');
      setDocuments(previousDocuments);
    } finally {
      setIsSavingRename(false);
    }
  }, [documents, renamingIndex, renameValue, updateProjectFile]);

  const handleCancelRename = useCallback(() => {
    setRenamingIndex(null);
    setRenameValue('');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditDescription('');
  }, []);

  const handleDelete = useCallback((index: number) => {
    const updatedDocuments = documents.filter((_, i) => i !== index);
    setDocuments(updatedDocuments);
    setOpenMenuIndex(null);
  }, [documents]);

  const handleOpenSupportUploadModal = useCallback(() => {
    setSupportUploadFile(null);
    setSupportUploadDescription('');
    setSupportUploadError(null);
    setIsSupportUploadModalOpen(true);
  }, []);

  const handleCloseSupportUploadModal = useCallback(() => {
    if (isSavingSupportUpload) return;
    setIsSupportUploadModalOpen(false);
  }, [isSavingSupportUpload]);

  const handleSupportFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSupportUploadFile(file);
    setSupportUploadError(null);
  }, []);

  const handleSaveSupportUpload = useCallback(async () => {
    if (!supportUploadFile) {
      setSupportUploadError('Please select a supporting document.');
      return;
    }

    setIsSavingSupportUpload(true);
    setSupportUploadError(null);

    try {
      const extractedContent = await extractTextFromDocument(supportUploadFile);
      const currentMaxOrder = documents.reduce((max, doc) => Math.max(max, doc.order ?? 0), 0);
      const nextOrder = currentMaxOrder + 1;

      const payload = {
        fileName: supportUploadFile.name,
        fileType: supportUploadFile.type || 'application/octet-stream',
        description: supportUploadDescription,
        content: extractedContent ?? '',
        order: nextOrder,
      };

      const response = await fetch('/api/project-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error ?? 'Failed to save supporting document.');
      }

      const data = await response.json();
      const savedFile = data.file ?? payload;

      const newDocument: SupportingDocument = {
        document_title: savedFile.fileName ?? payload.fileName,
        description: savedFile.description ?? payload.description ?? '',
        fileType: savedFile.fileType ?? payload.fileType,
        order: savedFile.order ?? payload.order,
        content: savedFile.content ?? payload.content ?? '',
      };

      setDocuments((prev) =>
        [...prev, newDocument].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      );

      setIsSupportUploadModalOpen(false);
      setSupportUploadFile(null);
      setSupportUploadDescription('');

      postSupportingDocument({
        title: newDocument.document_title,
        content: newDocument.content ?? '',
        description: newDocument.description,
        schema: '',
        projectInfo,
      }).catch((error) => {
        console.error(
          `Failed to create supporting document record for ${newDocument.document_title}:`,
          error,
        );
      });
    } catch (error) {
      console.error('Failed to upload supporting document:', error);
      alert(error instanceof Error ? error.message : 'Failed to upload supporting document.');
    } finally {
      setIsSavingSupportUpload(false);
    }
  }, [documents, extractTextFromDocument, projectInfo, supportUploadDescription, supportUploadFile]);

  const claimMap = useMemo(() => {
    const pairs: Array<[string, ClaimSpan]> = claims
      .filter((claim): claim is ClaimSpan & { id: string } => typeof claim.id === 'string' && claim.id.length > 0)
      .map((claim) => [claim.id, claim]);
    return new Map<string, ClaimSpan>(pairs);
  }, [claims]);

  const handleOpenAnalysisSidebar = useCallback(() => {
    if (!hasAnyAnalysisResults) return;
    setIsAnalysisSidebarMounted(true);
    requestAnimationFrame(() => setIsAnalysisSidebarOpen(true));
  }, [hasAnyAnalysisResults]);

  const handleCloseAnalysisSidebar = useCallback(() => {
    setIsAnalysisSidebarOpen(false);
  }, []);

  const handleOpenProjectInfo = useCallback(() => {
    setProjectForm(projectInfo);
    setIsProjectModalOpen(true);
  }, [projectInfo]);

  const handleCloseProjectInfo = useCallback(() => {
    if (isSavingProjectInfo) return;
    setIsProjectModalOpen(false);
  }, [isSavingProjectInfo]);

  const handleProjectFormChange = useCallback(
    (field: 'title' | 'projectDescription' | 'technicalDomain', value: string) => {
      setProjectForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const handleSaveProjectInfo = useCallback(async () => {
    if (!projectForm.title.trim()) {
      alert('Project title cannot be empty.');
      return;
    }

    setIsSavingProjectInfo(true);
    try {
      const response = await fetch('/api/project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: projectForm.title.trim(),
          projectDescription: projectForm.projectDescription,
          technicalDomain: projectForm.technicalDomain,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error ?? 'Failed to update project details.');
      }

      const data = await response.json();
      const updatedProject = data.project ?? {};

      setProjectInfo({
        title:
          updatedProject.title && updatedProject.title.trim().length > 0
            ? updatedProject.title.trim()
            : projectForm.title.trim(),
        projectDescription: updatedProject.projectDescription ?? projectForm.projectDescription ?? '',
        technicalDomain: updatedProject.technicalDomain ?? projectForm.technicalDomain ?? '',
      });

      setIsProjectModalOpen(false);
    } catch (error) {
      console.error('Failed to update project info:', error);
      alert(error instanceof Error ? error.message : 'Failed to update project info.');
    } finally {
      setIsSavingProjectInfo(false);
    }
  }, [projectForm]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuIndex(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!hasAnyAnalysisResults) {
      setIsAnalysisSidebarOpen(false);
      setIsAnalysisSidebarMounted(false);
      setIsAnalysisView(false);
      setSelectedInsight(null);
      return;
    }

    if (analysisMode === 'fact-check' && !hasFactResults && hasLogicalResults) {
      setAnalysisMode('logical');
    } else if (analysisMode === 'logical' && !hasLogicalResults && hasFactResults) {
      setAnalysisMode('fact-check');
    }
  }, [analysisMode, hasAnyAnalysisResults, hasFactResults, hasLogicalResults]);

  useEffect(() => {
    setSelectedInsight(null);
  }, [analysisMode]);

  useEffect(() => {
    if (!isAnalysisSidebarOpen && isAnalysisSidebarMounted) {
      const timeout = setTimeout(() => setIsAnalysisSidebarMounted(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [isAnalysisSidebarOpen, isAnalysisSidebarMounted]);

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Header */}
      <header className="w-full px-8 py-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black">
        <div className="flex w-full items-center">
          <div className="flex-1">
            <Link
              href="/"
              className="text-2xl font-bold text-black dark:text-white hover:opacity-80 transition-opacity"
            >
              logical.ly
            </Link>
          </div>
          <div className="flex-1 text-center">
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {projectInfo.title}
            </p>
          </div>
          <div className="flex-1 flex justify-end items-center gap-4">
            <button
              onClick={handleOpenProjectInfo}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            >
              Edit project details
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            } fixed inset-y-0 left-0 z-40 w-80 border-r border-zinc-200 bg-white pt-[73px] transition-transform duration-300 ease-in-out dark:border-zinc-800 dark:bg-zinc-900`}
        >
          <div className="flex h-full flex-col p-6">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Supporting Documents
            </h2>
            <button
              onClick={handleOpenSupportUploadModal}
              className="mb-4 flex items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            >
              + Add supporting file
            </button>
            <div className="flex-1 overflow-y-auto">
              {documents.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No supporting documents yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    >
                      <span className="flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
                        {doc.document_title}
                      </span>
                      <div className="relative" ref={openMenuIndex === index ? menuRef : null}>
                        <button
                          onClick={() => toggleMenu(index)}
                          className="ml-2 flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        >
                          <svg
                            className="h-4 w-4 text-zinc-600 dark:text-zinc-300"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <circle cx="8" cy="3" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="13" r="1.5" />
                          </svg>
                        </button>

                        {/* Dropdown Menu */}
                        {openMenuIndex === index && (
                          <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                            <button
                              onClick={() => handleEdit(index)}
                              className="flex w-full items-center px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              Edit Description
                            </button>
                            <button
                              onClick={() => handleRename(index)}
                              className="flex w-full items-center px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleDelete(index)}
                              className="flex w-full items-center px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Editor Area */}
        <main className="flex flex-1 flex-col">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-6">
            {/* Upload Button */}
            <div className="mb-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleUploadClick}
                    className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    <svg
                      className="h-4 w-4 text-current"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                    Upload Main Document
                  </button>
                  {uploadedFileName && (
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">
                      {uploadedFileName}
                    </span>
                  )}
                </div>

                <button
                  onClick={toggleSidebar}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  <svg
                    className="h-4 w-4 text-current"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 7h14M5 12h10M5 17h7"
                    />
                  </svg>
                  Add/Edit Supporting Documents
                </button>

                <button
                  onClick={handleCheckLogicalDiscrepancies}
                  disabled={isLogicalCheckLoading || !content.trim()}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  {isLogicalCheckLoading ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500" />
                      Checking for logical discrepancies…
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-4 w-4 text-current"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8c-1.657 0-3 1.343-3 3m0 0a3 3 0 006 0m-6 0H6m9 0h3m-9 0l-3 9m9-9l3 9"
                        />
                      </svg>
                      Check for Logical Discrepancies
                    </>
                  )}
                </button>

                <button
                  onClick={handleRunFactCheck}
                  disabled={isFactCheckLoading}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  {isFactCheckLoading ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500" />
                      Running fact check…
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-4 w-4 text-current"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11c0 5-7 10-7 10s-7-5-7-10a7 7 0 1114 0z"
                        />
                        <circle cx="12" cy="11" r="3" strokeWidth={2} />
                      </svg>
                      Run Fact Check
                    </>
                  )}
                </button>
              </div>

              {logicalCheckError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {logicalCheckError}
                </div>
              )}

              {logicalCheckSuccess && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  {logicalCheckSuccess}
                </div>
              )}

              {factCheckError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {factCheckError}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.text,.log,.csv,.pdf,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            {isAnalysisView && canShowAnalysisContent ? (
              <div className="flex flex-col gap-6">
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-col gap-4">
                    {hasFactResults && hasLogicalResults && (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                          View
                        </span>
                        <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900">
                          <button
                            type="button"
                            onClick={() => setAnalysisMode('fact-check')}
                            disabled={!hasFactResults}
                            className={`rounded-full px-3 py-1 transition ${analysisMode === 'fact-check'
                              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                              } ${!hasFactResults ? 'cursor-not-allowed opacity-40' : ''}`}
                          >
                            Fact Check
                          </button>
                          <button
                            type="button"
                            onClick={() => setAnalysisMode('logical')}
                            disabled={!hasLogicalResults}
                            className={`rounded-full px-3 py-1 transition ${analysisMode === 'logical'
                              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                              } ${!hasLogicalResults ? 'cursor-not-allowed opacity-40' : ''}`}
                          >
                            Logical Discrepancies
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {analysisMode === 'logical'
                            ? 'Logical discrepancy view'
                            : 'Fact-check view'}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {analysisMode === 'logical'
                            ? 'Red highlights mark contradictions with supporting documents.'
                            : 'Highlight colors show verdicts. Click any highlight to inspect it.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        {analysisMode === 'logical' ? (
                          <span className="rounded-full border border-red-200 bg-red-50/70 px-3 py-1 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100">
                            Contradiction
                          </span>
                        ) : (
                          <>
                            <span className="rounded-full border border-red-200 bg-red-50/70 px-3 py-1 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100">
                              Contradicted
                            </span>
                            <span className="rounded-full border border-amber-200 bg-amber-50/70 px-3 py-1 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
                              Uncertain
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-900 whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100">
                    {highlightSegments.map((segment, index) =>
                      segment.type === 'text' ? (
                        <span key={`segment-${index}`}>{segment.text}</span>
                      ) : (
                        <span
                          key={`segment-${index}`}
                          onClick={() => handleHighlightSelect(segment)}
                          className={`cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:opacity-90 ${verdictTextClass(
                            segment.verdict,
                          )}`}
                          title={
                            segment.mode === 'logical'
                              ? 'Click to review contradiction details'
                              : `Click to see suggestion (${segment.verdict.toUpperCase()})`
                          }
                        >
                          <span>{segment.text}</span>
                          {segment.tag === 'contradiction' && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-red-500">
                              contradiction
                            </span>
                          )}
                        </span>
                      ),
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setIsAnalysisView(false)}
                    className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    Back to editor
                  </button>
                </div>
              </div>
            ) : (
              <textarea
                value={content}
                onChange={handleContentChange}
                placeholder="Start typing or upload a document..."
                className="h-full min-h-[calc(100vh-200px)] w-full resize-none rounded-lg border border-zinc-200 bg-white px-6 py-4 text-base leading-relaxed text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-0 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-600"
                spellCheck="true"
                autoFocus={!isAnalysisView}
              />
            )}
          </div>
        </main>
      </div>

      {hasAnyAnalysisResults && (
        <div className="fixed bottom-6 right-6 z-30">
          <button
            onClick={handleOpenAnalysisSidebar}
            className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Show analysis
          </button>
        </div>
      )}

      {/* Overlay when sidebar is open */}
      {isSidebarOpen && (
        <div
          onClick={toggleSidebar}
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
        />
      )}

      {/* Insight Sidebar */}
      {selectedInsight && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/10"
            onClick={() => setSelectedInsight(null)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-zinc-200 bg-white shadow-2xl sm:max-w-sm lg:max-w-md dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                <div>
                  <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                    {selectedInsight.mode === 'logical' ? 'Logical discrepancy' : 'Selected claim'}
                  </p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedInsight.mode === 'logical'
                      ? 'Contradiction'
                      : verdictLabel(selectedInsight.verdict)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedInsight(null)}
                  className="rounded-full border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                    <path
                      d="M6 6l8 8m0-8l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                {selectedInsight.mode === 'logical' ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                        Proposition (main document)
                      </p>
                      <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                        {selectedInsight.proposition.chunk_text ||
                          selectedInsight.proposition.text ||
                          'No text available.'}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Source: {selectedInsight.proposition.doc_title}
                      </p>
                    </div>

                    {selectedInsight.pairwiseContradictions.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                          Conflicting supporting claims
                        </p>
                        {selectedInsight.pairwiseContradictions.map((item, idx) => (
                          <div
                            key={`pairwise-${item.claim.id}-${idx}`}
                            className="rounded-lg border border-red-200 bg-red-50/70 p-4 text-sm text-zinc-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100"
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
                              Document
                            </p>
                            <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                              {item.claim.doc_title}
                            </p>
                            <p className="mt-2 text-xs font-semibold text-red-900 dark:text-red-100">
                              Claim
                            </p>
                            <p className="text-sm text-red-900 dark:text-red-100">
                              “{item.claim.text}”
                            </p>
                            <p className="mt-2 text-xs font-semibold uppercase text-red-800 dark:text-red-200">
                              Reason
                            </p>
                            <p className="text-xs text-red-800 dark:text-red-200">{item.reason}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedInsight.graphContradictions.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                          Graph-based contradictions
                        </p>
                        {selectedInsight.graphContradictions.map((item) => (
                          <div
                            key={item.evidence_id}
                            className="rounded-lg border border-red-100 bg-red-50/60 p-4 text-sm text-zinc-900 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100"
                          >
                            <p className="font-medium">{item.evidence_text}</p>
                            <p className="mt-2 text-xs text-red-800 dark:text-red-200">{item.reason}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                        Claim text
                      </p>
                      <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                        {selectedInsight.text}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                        Verdict
                      </p>
                      <span
                        className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${verdictPillClass(
                          selectedInsight.verdict,
                        )}`}
                      >
                        {selectedInsight.verdict.toUpperCase()}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                        Suggestion
                      </p>
                      <p className="rounded-lg border border-amber-100 bg-amber-50/60 p-4 text-sm text-zinc-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
                        {selectedInsight.suggestion ?? 'No suggestion was provided.'}
                      </p>
                    </div>

                    {selectedInsight.correction && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                          Correct information
                        </p>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-zinc-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100">
                          <p>{selectedInsight.correction}</p>
                          {selectedInsight.correctionSource && (
                            <a
                              href={selectedInsight.correctionSource}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-block text-xs font-semibold text-blue-600 dark:text-blue-400"
                            >
                              View source
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedInsight.evidence && selectedInsight.evidence.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                          Evidence
                        </p>
                        {selectedInsight.evidence.map((evi, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800"
                          >
                            <p className="text-sm text-zinc-800 dark:text-zinc-100">
                              {evi.snippet || 'No snippet available.'}
                            </p>
                            {evi.sourceUrl && (
                              <a
                                href={evi.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-block text-xs font-semibold text-blue-600 dark:text-blue-400"
                              >
                                {evi.sourceUrl}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </aside>
        </>
      )}

      {isAnalysisSidebarMounted && hasAnyAnalysisResults && (
        <>
          <div
            className={`fixed inset-0 z-40 bg-black/10 transition-opacity duration-300 ${isAnalysisSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={handleCloseAnalysisSidebar}
          />
          <aside
            className={`fixed inset-y-0 right-0 z-50 w-full max-w-md transform border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-300 dark:border-zinc-800 dark:bg-zinc-900 sm:max-w-sm lg:max-w-md ${isAnalysisSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    {analysisMode === 'logical' ? 'Logical discrepancies' : 'Fact-check analysis'}
                  </p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {analysisMode === 'logical'
                      ? `${logicalResults.length} flagged proposition${logicalResults.length === 1 ? '' : 's'}`
                      : `${factCheckResults.length} findings`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {hasFactResults && hasLogicalResults && (
                    <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900">
                      <button
                        type="button"
                        onClick={() => setAnalysisMode('fact-check')}
                        disabled={!hasFactResults}
                        className={`rounded-full px-3 py-1 transition ${analysisMode === 'fact-check'
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                          } ${!hasFactResults ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        Fact Check
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnalysisMode('logical')}
                        disabled={!hasLogicalResults}
                        className={`rounded-full px-3 py-1 transition ${analysisMode === 'logical'
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                          } ${!hasLogicalResults ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        Logical
                      </button>
                    </div>
                  )}
                  <button
                    onClick={handleCloseAnalysisSidebar}
                    className="rounded-full border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M6 6l8 8m0-8l-8 8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
                {analysisMode === 'logical' ? (
                  logicalResults.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      No logical contradictions detected.
                    </p>
                  ) : (
                    logicalResults.map((result, index) => (
                      <div
                        key={`logical-${result.proposition.id}-${index}`}
                        className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                              Proposition
                            </p>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {result.proposition.chunk_text ||
                                result.proposition.text ||
                                'Text unavailable'}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              {result.proposition.doc_title}
                            </p>
                          </div>
                          <span className="rounded-full border border-red-200 bg-red-50/70 px-3 py-1 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100">
                            Contradiction
                          </span>
                        </div>

                        {result.pairwise_contradictions.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                              Conflicting supporting claims
                            </p>
                            {result.pairwise_contradictions.map((item, idx) => (
                              <div
                                key={`${result.proposition.id}-pair-${idx}`}
                                className="rounded-lg border border-red-100 bg-red-50/60 p-3 text-sm text-zinc-900 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100"
                              >
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
                                  Document
                                </p>
                                <p className="font-semibold text-red-900 dark:text-red-100">
                                  {item.claim.doc_title}
                                </p>
                                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
                                  Claim
                                </p>
                                <p className="text-sm text-red-900 dark:text-red-100">
                                  “{item.claim.text}”
                                </p>
                                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
                                  Reason
                                </p>
                                <p className="text-xs text-red-900 dark:text-red-200">
                                  {item.reason}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {result.graph_text_contradictions.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                              Graph insights
                            </p>
                            {result.graph_text_contradictions.map((item) => (
                              <div
                                key={item.evidence_id}
                                className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                              >
                                <p className="font-medium">{item.evidence_text}</p>
                                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                  {item.reason}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )
                ) : (
                  factCheckResults.map((result, index) => {
                    const claim =
                      typeof result.id === 'string' ? claimMap.get(result.id) : undefined;
                    return (
                      <div
                        key={`${result.id}-${index}`}
                        className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                              Claim
                            </p>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {claim?.claimText ?? 'Claim unavailable'}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${verdictPillClass(
                              result.verdict,
                            )}`}
                          >
                            {verdictLabel(result.verdict)}
                          </span>
                        </div>

                        {result.suggestion && (
                          <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50/70 p-3 text-sm text-zinc-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                            <p className="text-xs font-semibold uppercase text-amber-800 dark:text-amber-200">
                              Suggestion
                            </p>
                            <p>{result.suggestion}</p>
                          </div>
                        )}

                        {result.correction && (
                          <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-zinc-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100">
                            <p className="text-xs font-semibold uppercase text-emerald-800 dark:text-emerald-200">
                              Correction
                            </p>
                            <p>{result.correction}</p>
                            {result.correctionSource && (
                              <a
                                href={result.correctionSource}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-block text-xs font-semibold text-blue-600 dark:text-blue-400"
                              >
                                View source
                              </a>
                            )}
                          </div>
                        )}

                        {result.evidence && result.evidence.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                              Evidence
                            </p>
                            {result.evidence.map((evidence, idx) => (
                              <div
                                key={`${result.id}-evidence-${idx}`}
                                className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900"
                              >
                                <p>{evidence.snippet || 'No snippet available.'}</p>
                                {evidence.sourceUrl && (
                                  <a
                                    href={evidence.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-block text-xs font-semibold text-blue-600 dark:text-blue-400"
                                  >
                                    {evidence.sourceUrl}
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Project Metadata Modal */}
      {isProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Project details
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Update the project name, description, and technical domain.
                </p>
              </div>
              <button
                onClick={handleCloseProjectInfo}
                disabled={isSavingProjectInfo}
                className="rounded-full border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M6 6l8 8m0-8l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Project title
                </label>
                <input
                  value={projectForm.title}
                  onChange={(e) => handleProjectFormChange('title', e.target.value)}
                  disabled={isSavingProjectInfo}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
                  placeholder="Enter a descriptive project name"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Project description
                </label>
                <textarea
                  value={projectForm.projectDescription}
                  onChange={(e) => handleProjectFormChange('projectDescription', e.target.value)}
                  disabled={isSavingProjectInfo}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
                  placeholder="Describe the project or add helpful context"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Technical domain
                </label>
                <div className="relative">
                  <select
                    value={projectForm.technicalDomain}
                    onChange={(e) => handleProjectFormChange('technicalDomain', e.target.value)}
                    disabled={isSavingProjectInfo}
                    className="w-full appearance-none rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-10 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
                  >
                    {TECHNICAL_DOMAINS.map((domain) => (
                      <option key={domain.value} value={domain.value}>
                        {domain.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="h-4 w-4 text-zinc-400" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M6 8l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={handleCloseProjectInfo}
                disabled={isSavingProjectInfo}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${isSavingProjectInfo
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  } bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProjectInfo}
                disabled={isSavingProjectInfo}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 ${isSavingProjectInfo
                  ? 'bg-zinc-600 cursor-wait opacity-80 dark:bg-zinc-400'
                  : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200'
                  }`}
              >
                {isSavingProjectInfo ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support File Upload Modal */}
      {isSupportUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Upload supporting document
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Select a file and add a short description to keep things organized.
                </p>
              </div>
              <button
                onClick={handleCloseSupportUploadModal}
                disabled={isSavingSupportUpload}
                className="rounded-full border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M6 6l8 8m0-8l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Supporting file
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,.csv"
                  onChange={handleSupportFileChange}
                  disabled={isSavingSupportUpload}
                  className="w-full cursor-pointer rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-6 text-sm text-zinc-600 transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500"
                />
                {supportUploadFile && (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    Selected: <span className="font-medium">{supportUploadFile.name}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Description
                </label>
                <textarea
                  value={supportUploadDescription}
                  onChange={(e) => setSupportUploadDescription(e.target.value)}
                  disabled={isSavingSupportUpload}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
                  placeholder="Add a short summary or key details about this document"
                />
              </div>

              {supportUploadError && (
                <p className="text-sm text-red-600 dark:text-red-400">{supportUploadError}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={handleCloseSupportUploadModal}
                disabled={isSavingSupportUpload}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${isSavingSupportUpload
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  } bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSupportUpload}
                disabled={isSavingSupportUpload || !supportUploadFile}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 ${isSavingSupportUpload
                  ? 'bg-zinc-600 cursor-wait opacity-80 dark:bg-zinc-400'
                  : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200'
                  }`}
              >
                {isSavingSupportUpload ? 'Saving...' : 'Save file'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Description Modal */}
      {editingIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Edit Description
            </h3>
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {documents[editingIndex].document_title}
            </p>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="mb-4 h-32 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-0 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
              placeholder="Enter description..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelEdit}
                disabled={isSavingEdit}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${isSavingEdit
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  } bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 ${isSavingEdit
                  ? 'bg-zinc-700 cursor-wait opacity-80 dark:bg-zinc-300'
                  : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200'
                  }`}
              >
                {isSavingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Document Modal */}
      {renamingIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Rename Document
            </h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mb-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-0 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
              placeholder="Enter new document name"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelRename}
                disabled={isSavingRename}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${isSavingRename
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  } bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRename}
                disabled={isSavingRename}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 ${isSavingRename
                  ? 'bg-zinc-700 cursor-wait opacity-80 dark:bg-zinc-300'
                  : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200'
                  }`}
              >
                {isSavingRename ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
