import Link from 'next/link';
import ThemeToggle from './components/ThemeToggle';

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-black flex flex-col">
      {/* Navigation */}
      <nav className="w-full px-8 py-6 flex justify-between items-center border-b border-gray-200 dark:border-gray-800">
        <div className="text-2xl font-bold text-black dark:text-white">
          logical.ly
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link
            href="/upload"
            className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
          >
            Get Started →
          </Link>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-8 py-16">
        <div className="max-w-4xl w-full">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h1 className="text-6xl md:text-7xl font-bold text-black dark:text-white mb-6 tracking-tight">
              Catch errors
              <br />
              <span className="text-gray-400 dark:text-gray-600">before they catch you</span>
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
              Compare your main document against supporting materials to catch contradictions, 
              inconsistencies, and factual errors before they become problems.
            </p>
          </div>

          {/* CTA Button */}
          <div className="flex justify-center mb-20">
            <Link
              href="/upload"
              className="px-8 py-4 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors shadow-lg hover:shadow-xl"
            >
              Start Analyzing
            </Link>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 mt-20">
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
              <div className="text-3xl mb-4">🔍</div>
              <h3 className="font-semibold text-lg text-black dark:text-white mb-2">
                Logical Fallacies
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Detect contradictions, circular reasoning, and false premises across your documents.
              </p>
            </div>

            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
              <div className="text-3xl mb-4">✓</div>
              <h3 className="font-semibold text-lg text-black dark:text-white mb-2">
                Factual Accuracy
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Cross-reference dates, numbers, names, and facts to ensure consistency.
              </p>
            </div>

            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
              <div className="text-3xl mb-4">📄</div>
              <h3 className="font-semibold text-lg text-black dark:text-white mb-2">
                Multi-Document
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Compare your main document against multiple supporting files simultaneously.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full px-8 py-6 border-t border-gray-200 dark:border-gray-800 text-center text-sm text-gray-500 dark:text-gray-500">
        <p>Built for precision. Designed for clarity.</p>
      </footer>
    </div>
  );
}
