import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    // Create data directory if it doesn't exist
    const dataDir = join(process.cwd(), 'data');
    try {
      await mkdir(dataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, that's fine
    }

    // Use a fixed filename so we overwrite the existing file
    const filename = 'project-data.json';
    const filepath = join(dataDir, filename);

    // Write JSON file
    await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      message: 'Project data saved successfully',
      filename,
      filepath,
    });
  } catch (error) {
    console.error('Error saving project data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save project data' },
      { status: 500 }
    );
  }
}

