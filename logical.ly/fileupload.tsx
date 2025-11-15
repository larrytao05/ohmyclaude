'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from './app/components/ThemeToggle';

interface FileWithDescription {
  file: File;
  description: string;
  isExpanded: boolean;
}

export default function FileUpload() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [technicalDomain, setTechnicalDomain] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<FileWithDescription[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [touchedFields, setTouchedFields] = useState({
    title: false,
    description: false,
    domain: false,
    files: false,
  });

  const hasUnsavedData = () => {
    return (
      title.trim() !== '' ||
      projectDescription.trim() !== '' ||
      technicalDomain !== '' ||
      uploadedFiles.length > 0
    );
  };

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (hasUnsavedData()) {
      e.preventDefault();
      setShowExitConfirm(true);
    }
  };

  const processFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newFiles: FileWithDescription[] = fileArray.map(file => ({
      file,
      description: '',
      isExpanded: true,
    }));
    setUploadedFiles((prev) => [...prev, ...newFiles]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
      setTouchedFields({ ...touchedFields, files: true });
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleExpand = (index: number) => {
    setUploadedFiles((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, isExpanded: !item.isExpanded } : item
      )
    );
  };

  const updateDescription = (index: number, description: string) => {
    setUploadedFiles((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, description } : item
      )
    );
  };

  const clearAllTextFields = () => {
    setTitle('');
    setProjectDescription('');
    setTechnicalDomain('');
    setTouchedFields({
      title: false,
      description: false,
      domain: false,
      files: touchedFields.files,
    });
  };

  const clearAllFiles = () => {
    setUploadedFiles([]);
    setTouchedFields({
      ...touchedFields,
      files: false,
    });
  };

  const isFormValid = 
    title.trim() !== '' && 
    projectDescription.trim() !== '' && 
    technicalDomain !== '' && 
    uploadedFiles.length > 0;

  const getMissingRequirements = () => {
    const missing: string[] = [];
    if (title.trim() === '') missing.push('Title');
    if (projectDescription.trim() === '') missing.push('Project Description');
    if (technicalDomain === '') missing.push('Technical Domain');
    if (uploadedFiles.length === 0) missing.push('At least one supporting document');
    return missing;
  };

  const handleSubmit = async () => {
    if (isFormValid && !isUploading) {
      setIsUploading(true);
      setUploadProgress(0);
      
      try {
        // Create JSON object with all form data
        const projectData = {
          title,
          projectDescription,
          technicalDomain,
          uploadedFiles: uploadedFiles.map((fileItem, index) => ({
            fileName: fileItem.file.name,
            fileType: fileItem.file.type,
            description: fileItem.description,
            order: index + 1, // Unique sequential number (1, 2, 3, 4...)
          })),
        };

        // Simulate progress for JSON save (since fetch doesn't support progress for JSON)
        // In a real scenario, you'd track progress if uploading actual files
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => {
            if (prev >= 90) {
              clearInterval(progressInterval);
              return 90;
            }
            return prev + 10;
          });
        }, 100);

        // Save to file on server via API route
        const response = await fetch('/api/save-project-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(projectData),
        });

        clearInterval(progressInterval);
        setUploadProgress(100);

        if (!response.ok) {
          throw new Error('Failed to save project data');
        }

        const result = await response.json();
        console.log('Project data saved:', result);

        // Small delay to show 100% before navigation
        setTimeout(() => {
          // TODO: Upload files to server/backend
          // For now, navigate to editor page
          // In production, you'd want to upload files first and pass the data
          router.push(`/editor?projectId=${result.filename || 'temp'}`);
        }, 300);
      } catch (error) {
        console.error('Error saving project data:', error);
        setUploadProgress(0);
        setIsUploading(false);
        alert('Failed to save project data. Please try again.');
      }
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black flex flex-col">
      {/* Logo and theme toggle */}
      <nav className="w-full px-8 py-6 flex justify-between items-center border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <Link 
          href="/" 
          onClick={handleLogoClick}
          className="text-2xl font-bold text-black dark:text-white hover:opacity-80 transition-opacity"
        >
          logical.ly
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle />
        </div>
      </nav>

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Leave Page?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              You have unsaved changes. If you leave now, you will lose your submissions. Do you want to continue?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <Link
                href="/"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Leave Page
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main content area - split 1/3 : 2/3 */}
      <div className="flex flex-1 px-8 pt-6 pb-6 min-h-0 gap-6">
        {/* Left 1/3 - Input fields */}
        <div className="w-1/3 flex flex-col min-h-0">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-6 overflow-y-auto">
            {/* Clear text fields button - fixed height container to prevent card expansion */}
            <div className="h-10 flex justify-end items-start -mt-2 -mb-4">
              {(title.trim() !== '' || projectDescription.trim() !== '' || technicalDomain !== '') && (
                <button
                  onClick={clearAllTextFields}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear All Fields
                </button>
              )}
            </div>
            <div>
              <label htmlFor="title" className="block text-base font-semibold text-gray-900 dark:text-gray-100 mb-2.5">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTouchedFields({ ...touchedFields, title: true })}
                placeholder="Enter project title"
                className={`w-full px-4 py-3 text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-all shadow-sm hover:border-gray-400 dark:hover:border-gray-500 ${
                  title.trim() === '' && touchedFields.title
                    ? 'border-red-400 dark:border-red-600'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              {title.trim() === '' && touchedFields.title && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">Title is required</p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="block text-base font-semibold text-gray-900 dark:text-gray-100 mb-2.5">
                Project Description
              </label>
              <textarea
                id="description"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                onBlur={() => setTouchedFields({ ...touchedFields, description: true })}
                placeholder="Enter project description"
                rows={4}
                className={`w-full px-4 py-3 text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none transition-all shadow-sm hover:border-gray-400 dark:hover:border-gray-500 ${
                  projectDescription.trim() === '' && touchedFields.description
                    ? 'border-red-400 dark:border-red-600'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              {projectDescription.trim() === '' && touchedFields.description && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">Project description is required</p>
              )}
            </div>

            <div>
              <label htmlFor="domain" className="block text-base font-semibold text-gray-900 dark:text-gray-100 mb-2.5">
                Technical Domain
              </label>
              <div className="relative">
                <select
                  id="domain"
                  value={technicalDomain}
                  onChange={(e) => setTechnicalDomain(e.target.value)}
                  onBlur={() => setTouchedFields({ ...touchedFields, domain: true })}
                  className={`w-full px-4 py-3 pr-10 text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 appearance-none cursor-pointer transition-all shadow-sm hover:border-gray-400 dark:hover:border-gray-500 ${
                    technicalDomain === '' && touchedFields.domain
                      ? 'border-red-400 dark:border-red-600'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  <option value="">Select a domain</option>
                  <option value="software-engineering">Software Engineering</option>
                  <option value="data-science">Data Science</option>
                  <option value="machine-learning">Machine Learning</option>
                  <option value="web-development">Web Development</option>
                  <option value="mobile-development">Mobile Development</option>
                  <option value="devops">DevOps</option>
                  <option value="cybersecurity">Cybersecurity</option>
                  <option value="cloud-computing">Cloud Computing</option>
                  <option value="other">Other</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {technicalDomain === '' && touchedFields.domain && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">Technical domain is required</p>
              )}
            </div>
          </div>
        </div>

        {/* Right 2/3 - File upload area */}
        <div className="w-2/3 flex flex-col min-h-0">
          {/* Summary of uploaded files at top */}
          {uploadedFiles.length > 0 && (
            <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Uploaded Files ({uploadedFiles.length})
                </h3>
                <button
                  onClick={clearAllFiles}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear All Files
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {uploadedFiles.map((fileItem, index) => (
                  <div
                    key={index}
                    className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden transition-all hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center flex-1 min-w-0">
                        <button
                          onClick={() => toggleExpand(index)}
                          className="mr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0 transition-colors"
                        >
                          <svg
                            className={`w-4 h-4 transition-transform ${fileItem.isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                          {fileItem.file.name}
                        </span>
                      </div>
                      <button
                        onClick={() => removeFile(index)}
                        className="ml-3 px-3 py-1 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                    {fileItem.isExpanded && (
                      <div className="px-3 pb-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                        <textarea
                          value={fileItem.description}
                          onChange={(e) => updateDescription(index, e.target.value)}
                          placeholder="Describe what this document is about..."
                          rows={3}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none transition-all"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File upload area */}
          <div
            className={`flex-1 border-2 border-dashed rounded-xl flex items-center justify-center transition-all ${
              isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400 shadow-lg scale-[1.02]'
                : uploadedFiles.length === 0 && touchedFields.files
                ? 'border-red-300 dark:border-red-600/50 hover:border-red-400 dark:hover:border-red-600 hover:bg-red-50/30 dark:hover:bg-red-900/10 bg-white dark:bg-gray-800 shadow-sm'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800/50 bg-white dark:bg-gray-800 shadow-sm'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => {
              handleDrop(e);
              setTouchedFields({ ...touchedFields, files: true });
            }}
            onClick={() => {
              if (uploadedFiles.length === 0) {
                setTouchedFields({ ...touchedFields, files: true });
              }
            }}
          >
            <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center p-12">
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt"
              />
              <div className="text-center">
                <div className={`mx-auto h-16 w-16 mb-5 rounded-full flex items-center justify-center transition-colors ${
                  isDragging 
                    ? 'bg-blue-100 dark:bg-blue-900/30' 
                    : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <svg
                    className={`h-8 w-8 transition-colors ${
                      isDragging
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Click to upload or drag and drop
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                  Supporting documents (PDF, DOC, DOCX, TXT)
                </p>
                {uploadedFiles.length === 0 && touchedFields.files && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-3 font-medium">
                    At least one document is required
                  </p>
                )}
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Upload button and progress indicator */}
      <div className="flex flex-col items-end px-8 pb-6 flex-shrink-0 gap-3">
        {/* Progress bar */}
        {isUploading && (
          <div className="w-64">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Uploading...
              </span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {uploadProgress}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-600 to-blue-700 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}

        <div 
          className="relative inline-block"
          onMouseEnter={() => !isFormValid && !isUploading && setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {!isFormValid && showTooltip && (
            <div className="absolute bottom-full right-0 mb-3 px-4 py-3 bg-gray-900 dark:bg-gray-800 text-white text-sm rounded-xl shadow-xl z-50 min-w-[220px] border border-gray-700">
              <div className="font-semibold mb-2 text-white">Missing requirements:</div>
              <ul className="list-disc list-inside space-y-1">
                {getMissingRequirements().map((req, index) => (
                  <li key={index} className="text-xs text-gray-200">{req}</li>
                ))}
              </ul>
              {/* Tooltip arrow */}
              <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-800"></div>
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={!isFormValid || isUploading}
            className={`px-8 py-3.5 rounded-lg font-semibold text-sm transition-all shadow-lg ${
              isFormValid && !isUploading
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white cursor-pointer hover:shadow-xl hover:scale-105 active:scale-100'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed shadow-none'
            }`}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}