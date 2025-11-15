'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import supportingDocumentsData from '../supporting-documents.json';
import mammoth from 'mammoth';

interface SupportingDocument {
  document_title: string;
  description: string;
  content: string;
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

type HighlightSegment =
  | { type: 'text'; text: string }
  | {
    type: 'highlight';
    text: string;
    verdict: ClaimCheckResult['verdict'];
    claimText: string;
    suggestion?: string;
    correction?: string;
    correctionSource?: string;
    evidence?: { snippet: string; sourceUrl: string }[];
  };

export default function Editor() {
  const [content, setContent] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [documents, setDocuments] = useState<SupportingDocument[]>(supportingDocumentsData);
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [claims, setClaims] = useState<ClaimSpan[]>([]);
  const [factCheckResults, setFactCheckResults] = useState<ClaimCheckResult[]>([]);
  const [isFactCheckLoading, setIsFactCheckLoading] = useState(false);
  const [factCheckError, setFactCheckError] = useState<string | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<{
    text: string;
    verdict: ClaimCheckResult['verdict'];
    suggestion?: string;
    correction?: string;
    correctionSource?: string;
    evidence?: { snippet: string; sourceUrl: string }[];
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    try {
      let extractedText = '';

      if (fileExtension === 'pdf') {
        // Handle PDF files - dynamically import pdfjs-dist
        const pdfjsLib = await import('pdfjs-dist');

        // Configure PDF.js worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
        // Handle DOCX files
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else {
        // Handle plain text files (txt, md, csv, etc.)
        extractedText = await file.text();
      }

      setContent(extractedText);
      setUploadedFileName(file.name);
    } catch (error) {
      console.error('Error reading file:', error);
      alert('Error reading file. Please try a different file or format.');
    }

    // Reset the input value so the same file can be uploaded again
    e.target.value = '';
  }, []);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRunFactCheck = useCallback(async () => {
    setIsFactCheckLoading(true);
    setFactCheckError(null);

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
      setFactCheckResults(data.results ?? []);
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

  const verdictTextClass = (verdict: ClaimCheckResult['verdict']) =>
    verdict === 'contradicted'
      ? 'bg-red-100/80 text-red-900 border border-red-200'
      : 'bg-amber-100/80 text-amber-900 border border-amber-200';

  const verdictPillClass = (verdict: ClaimCheckResult['verdict']) =>
    verdict === 'contradicted'
      ? 'bg-red-100 text-red-900 border border-red-200'
      : 'bg-amber-100 text-amber-900 border border-amber-200';

  const verdictLabel = (verdict: ClaimCheckResult['verdict']) =>
    verdict === 'contradicted' ? 'Contradicted' : 'Uncertain';

  const highlightSegments = useMemo<HighlightSegment[]>(() => {
    if (!content) {
      return [];
    }

    if (factCheckResults.length === 0) {
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

    const spans = factCheckResults
      .map((result) => {
        const claim = claims.find((c) => c.id === result.id);
        const claimText = claim?.claimText?.trim();
        if (!claimText) return null;

        const range = findAvailableRange(claimText);
        if (!range) return null;

        return {
          id: result.id,
          start: range.start,
          end: range.end,
          verdict: result.verdict,
          claimText,
          suggestion: result.suggestion,
          correction: result.correction,
          correctionSource: result.correctionSource,
          evidence: result.evidence ?? [],
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a!.start ?? 0) - (b!.start ?? 0)) as {
        id: string;
        start: number;
        end: number;
        verdict: ClaimCheckResult['verdict'];
        claimText: string;
        suggestion?: string;
        correction?: string;
        correctionSource?: string;
        evidence?: { snippet: string; sourceUrl: string }[];
      }[];

    const segments: HighlightSegment[] = [];
    let cursor = 0;

    spans.forEach((span) => {
      if (span.start > cursor) {
        segments.push({
          type: 'text',
          text: content.slice(cursor, span.start),
        });
      }

      segments.push({
        type: 'highlight',
        text: content.slice(span.start, span.end),
        verdict: span.verdict,
        claimText: span.claimText,
        suggestion: span.suggestion,
        correction: span.correction,
        correctionSource: span.correctionSource,
        evidence: span.evidence,
      });
      cursor = span.end;
    });

    if (cursor < contentLength) {
      segments.push({
        type: 'text',
        text: content.slice(cursor),
      });
    }

    return segments;
  }, [content, claims, factCheckResults]);

  const handleHighlightSelect = useCallback(
    (segment: Extract<HighlightSegment, { type: 'highlight' }>) => {
      setSelectedInsight({
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

  const handleEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditDescription(documents[index].description);
    setOpenMenuIndex(null);
  }, [documents]);

  const handleSaveEdit = useCallback(() => {
    if (editingIndex !== null) {
      const updatedDocuments = [...documents];
      updatedDocuments[editingIndex].description = editDescription;
      setDocuments(updatedDocuments);
      setEditingIndex(null);
      setEditDescription('');
    }
  }, [editingIndex, editDescription, documents]);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditDescription('');
  }, []);

  const handleDelete = useCallback((index: number) => {
    const updatedDocuments = documents.filter((_, i) => i !== index);
    setDocuments(updatedDocuments);
    setOpenMenuIndex(null);
  }, [documents]);

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

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-end">
          <h1 className="text-2xl font-semibold text-zinc-900">
            logical.ly
          </h1>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            } fixed inset-y-0 left-0 z-40 w-80 border-r border-zinc-200 bg-white pt-[73px] transition-transform duration-300 ease-in-out`}
        >
          <div className="flex h-full flex-col p-6">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900">
              Supporting Documents
            </h2>
            <div className="flex-1 overflow-y-auto">
              {documents.length === 0 ? (
                <p className="text-sm text-zinc-600">
                  No supporting documents yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3 hover:bg-zinc-50"
                    >
                      <span className="flex-1 truncate text-sm text-zinc-900">
                        {doc.document_title}
                      </span>
                      <div className="relative" ref={openMenuIndex === index ? menuRef : null}>
                        <button
                          onClick={() => toggleMenu(index)}
                          className="ml-2 flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-200"
                        >
                          <svg
                            className="h-4 w-4 text-zinc-600"
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
                          <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border border-zinc-200 bg-white shadow-lg">
                            <button
                              onClick={() => handleEdit(index)}
                              className="flex w-full items-center px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                            >
                              Edit Description
                            </button>
                            <button
                              onClick={() => handleDelete(index)}
                              className="flex w-full items-center px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
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
                    className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                  >
                    <svg
                      className="h-4 w-4"
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
                    <span className="text-sm text-zinc-600">
                      {uploadedFileName}
                    </span>
                  )}
                </div>

                <button
                  onClick={toggleSidebar}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300"
                >
                  <svg
                    className="h-4 w-4"
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
                  onClick={handleRunFactCheck}
                  disabled={isFactCheckLoading}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFactCheckLoading ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                      Running fact check…
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-4 w-4"
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

              {factCheckError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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

            <textarea
              value={content}
              onChange={handleContentChange}
              placeholder="Start typing or upload a document..."
              className="h-full min-h-[calc(100vh-200px)] w-full resize-none rounded-lg border border-zinc-200 bg-white px-6 py-4 text-base leading-relaxed text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-0"
              spellCheck="true"
              autoFocus
            />

            {factCheckResults.length > 0 && (
              <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Fact-check view</p>
                    <p className="text-xs text-zinc-500">
                      Highlight colors show verdicts. Click any highlight to inspect it.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-medium text-zinc-600">
                    <span className="rounded-full border border-red-200 bg-red-50/70 px-3 py-1 text-red-800">
                      Contradicted
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50/70 px-3 py-1 text-amber-800">
                      Uncertain
                    </span>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-900 whitespace-pre-wrap">
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
                        title={`Click to see suggestion (${segment.verdict.toUpperCase()})`}
                      >
                        {segment.text}
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

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
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-zinc-200 bg-white shadow-2xl sm:max-w-sm lg:max-w-md">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
                <div>
                  <p className="text-sm font-semibold text-zinc-500">Selected claim</p>
                  <p className="text-lg font-semibold text-zinc-900">{verdictLabel(selectedInsight.verdict)}</p>
                </div>
                <button
                  onClick={() => setSelectedInsight(null)}
                  className="rounded-full border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100"
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
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Claim text</p>
                  <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-900">
                    {selectedInsight.text}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Verdict</p>
                  <span
                    className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${verdictPillClass(
                      selectedInsight.verdict,
                    )}`}
                  >
                    {selectedInsight.verdict.toUpperCase()}
                  </span>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Suggestion</p>
                  <p className="rounded-lg border border-amber-100 bg-amber-50/60 p-4 text-sm text-zinc-800">
                    {selectedInsight.suggestion ?? 'No suggestion was provided.'}
                  </p>
                </div>

                {selectedInsight.correction && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-zinc-500">
                      Correct information
                    </p>
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-zinc-800">
                      <p>{selectedInsight.correction}</p>
                      {selectedInsight.correctionSource && (
                        <a
                          href={selectedInsight.correctionSource}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs font-semibold text-blue-600"
                        >
                          View source
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {selectedInsight.evidence && selectedInsight.evidence.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase text-zinc-500">Evidence</p>
                    {selectedInsight.evidence.map((evi, idx) => (
                      <div key={idx} className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                        <p className="text-sm text-zinc-800">{evi.snippet || 'No snippet available.'}</p>
                        {evi.sourceUrl && (
                          <a
                            href={evi.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs font-semibold text-blue-600"
                          >
                            {evi.sourceUrl}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Edit Description Modal */}
      {editingIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900">
              Edit Description
            </h3>
            <p className="mb-2 text-sm font-medium text-zinc-700">
              {documents[editingIndex].document_title}
            </p>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="mb-4 h-32 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-0"
              placeholder="Enter description..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelEdit}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
