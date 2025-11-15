import ThemeToggle from '../components/ThemeToggle';

export default function EditorPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black flex flex-col">
      <header className="w-full px-8 py-6 flex justify-between items-center border-b border-gray-200 dark:border-gray-800">
        <h1 className="text-2xl font-bold text-black dark:text-white">Editor</h1>
        <ThemeToggle />
      </header>
      <div className="flex-1 p-6">
        <p className="text-gray-600 dark:text-gray-400">
          This is where the text editor and discrepancy sidebar will go.
        </p>
      </div>
    </div>
  );
}

